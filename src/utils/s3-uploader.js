/**
 * S3上传工具
 * 处理图片上传到S3兼容存储
 * 使用 aws4fetch 实现 AWS Signature V4 签名
 */

import { AwsClient } from './aws4fetch.js';
import { t } from './i18n.js';

/**
 * 验证S3配置
 * 使用 AWS Signature V4 签名和 HeadBucket API
 * @param {Object} config - S3配置
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function validateS3Config(config) {
  try {
    const { accessKey, secretKey, endpoint, region, bucket } = config;
    
    if (!accessKey || !secretKey || !endpoint || !region || !bucket) {
      return { success: false, message: t('s3_error_configIncomplete') };
    }
    
    // 验证endpoint格式
    try {
      const url = new URL(endpoint);
      if (!url.protocol || !url.host) {
        return { success: false, message: t('s3_error_endpointInvalid') };
      }
    } catch (e) {
      return { success: false, message: 'ENDPOINT格式错误' };
    }
    
    // 使用 HeadBucket API 验证
    try {
      // 创建 AWS 客户端
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        region: region,
        service: 's3'
      });
      
      // 构建 HeadBucket 请求
      const url = `${endpoint.replace(/\/$/, '')}/${bucket}`;
      const response = await aws.fetch(url, { method: 'HEAD' });
      
      // 处理响应
      if (response.ok) {
        return { success: true, message: t('s3_success_connected') };
      }
      
      // 错误处理
      if (response.status === 403) {
        return { success: false, message: t('s3_error_accessKeyFailed') };
      }
      if (response.status === 404) {
        return { success: false, message: t('s3_error_bucketNotFound') };
      }
      if (response.status === 301 || response.status === 307) {
        return { success: false, message: t('s3_error_regionError') };
      }
      
      // 其他错误
      console.error('S3 HeadBucket 错误:', response.status, response.statusText);
      return { success: false, message: `S3连接失败: HTTP ${response.status}` };
      
    } catch (error) {
      console.error('S3验证失败', error);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return { success: false, message: t('s3_error_endpointUnreachable') };
      }
      
      return { success: false, message: `验证失败: ${error.message}` };
    }
    
  } catch (error) {
    console.error('S3配置验证失败', error);
    return { success: false, message: `验证失败: ${error.message}` };
  }
}

/**
 * 上传单张图片到S3
 * 使用 AWS Signature V4 签名和 PutObject API
 * @param {Blob} imageBlob - 图片Blob对象
 * @param {string} filename - 文件名
 * @param {Object} s3Config - S3配置 (包含accessKey, secretKey, endpoint, region, bucket, cdn, customPath, acl, presignedExpiry)
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
export async function uploadImage(imageBlob, filename, s3Config) {
  try {
    const { accessKey, secretKey, endpoint, region, bucket, cdn, customPath, acl, presignedExpiry } = s3Config;
    
    // 生成唯一文件名
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const ext = filename.split('.').pop() || 'jpg';
    const key = customPath 
      ? `${customPath}/${timestamp}-${randomStr}.${ext}`
      : `${timestamp}-${randomStr}.${ext}`;
    
    // 创建 AWS 客户端
    const aws = new AwsClient({
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      region: region,
      service: 's3'
    });
    
    // 构建 PutObject 请求
    const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    const headers = {
      'Content-Type': imageBlob.type || 'image/jpeg'
    };
    
    // 公开模式设置ACL header
    if (acl === 'public') {
      headers['x-amz-acl'] = 'public-read';
    }
    
    const response = await aws.fetch(url, {
      method: 'PUT',
      body: imageBlob,
      headers: headers
    });
    
    if (!response.ok) {
      if (response.status === 403) {
        console.error('S3上传权限错误: 403 Forbidden');
        return { success: false, message: t('s3_error_noPermission') };
      }
      console.error('S3上传失败:', response.status, response.statusText);
      throw new Error(`上传失败: HTTP ${response.status}`);
    }
    
    // 生成访问URL
    const imageUrl = await generateS3Url(bucket, key, s3Config);
    
    return {
      success: true,
      url: imageUrl,
      message: t('s3_success_uploaded')
    };
    
  } catch (error) {
    console.error('图片上传失败', error);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return { success: false, message: t('s3_error_uploadFailed') };
    }
    
    return {
      success: false,
      message: `上传失败: ${error.message}`
    };
  }
}

/**
 * 批量上传图片
 * @param {Array} imageArray - 图片数组 [{blob, filename}, ...]
 * @param {Object} s3Config - S3配置
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Array>} 上传结果数组
 */
export async function uploadImages(imageArray, s3Config, onProgress = null) {
  const results = [];
  const concurrency = 5; // 最大并发数
  
  for (let i = 0; i < imageArray.length; i += concurrency) {
    const batch = imageArray.slice(i, i + concurrency);
    const batchPromises = batch.map((item) => 
      uploadImageWithRetry(item.blob, item.filename, s3Config, 3)
    );
    
    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, message: 'Upload failed' }));
    
    // 调用进度回调
    if (onProgress) {
      onProgress(Math.min(i + concurrency, imageArray.length), imageArray.length);
    }
  }
  
  return results;
}

/**
 * 带重试的图片上传
 * @param {Blob} imageBlob - 图片Blob
 * @param {string} filename - 文件名
 * @param {Object} s3Config - S3配置
 * @param {number} retries - 重试次数
 * @returns {Promise<Object>}
 */
async function uploadImageWithRetry(imageBlob, filename, s3Config, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await uploadImage(imageBlob, filename, s3Config);
      if (result.success) {
        return result;
      }
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    } catch (error) {
      if (i === retries - 1) {
        return { success: false, message: error.message };
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return { success: false, message: t('s3_error_uploadFailedGeneric') };
}

/**
 * 生成S3访问URL
 * @param {string} bucket - 存储桶名称
 * @param {string} key - 对象键
 * @param {Object} config - S3配置对象 (包含cdn, acl, endpoint等)
 * @returns {Promise<string>} 访问URL
 */
export async function generateS3Url(bucket, key, config) {
  console.log('generateS3Url调用 - bucket:', bucket, 'key:', key, 'acl:', config.acl, 'cdn:', config.cdn);
  
  // 私密模式：生成预签名URL（优先级最高）
  if (config.acl === 'private') {
    console.log('ACL为private，生成预签名URL');
    const presignedUrl = await generatePresignedUrl(bucket, key, config);
    
    // 如果配置了CDN，替换域名为CDN域名（保留路径和所有签名参数）
    if (config.cdn) {
      console.log('检测到CDN配置，替换预签名URL的域名为CDN');
      const cdnUrl = replaceEndpointWithCDN(presignedUrl, config.endpoint, config.cdn);
      console.log('替换后的CDN预签名URL:', cdnUrl);
      return cdnUrl;
    }
    
    return presignedUrl;
  }
  
  // 公开模式
  // CDN优先
  if (config.cdn) {
    console.log('公开模式，使用CDN URL');
    return `${config.cdn.replace(/\/$/, '')}/${key}`;
  }
  
  // 简单URL拼接
  console.log('公开模式，生成简单URL');
  if (config.endpoint) {
    try {
      const url = new URL(config.endpoint);
      return `${url.protocol}//${bucket}.${url.host}/${key}`;
    } catch (e) {
      return `${config.endpoint}/${bucket}/${key}`;
    }
  }
  
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

/**
 * 替换预签名URL中的endpoint域名为CDN域名
 * @param {string} presignedUrl - 预签名URL
 * @param {string} endpoint - 原始S3 endpoint
 * @param {string} cdn - CDN地址
 * @returns {string} 替换后的CDN URL（保留所有签名参数）
 */
function replaceEndpointWithCDN(presignedUrl, endpoint, cdn) {
  try {
    const presignedUrlObj = new URL(presignedUrl);
    const cdnUrlObj = new URL(cdn);
    
    // 替换协议和主机，保留路径、查询参数（包括签名）和hash
    presignedUrlObj.protocol = cdnUrlObj.protocol;
    presignedUrlObj.host = cdnUrlObj.host;
    
    return presignedUrlObj.toString();
  } catch (error) {
    console.error('替换CDN域名失败，返回原始预签名URL', error);
    return presignedUrl;
  }
}

/**
 * 生成S3预签名URL
 * @param {string} bucket - 存储桶名称
 * @param {string} key - 对象键
 * @param {Object} config - S3配置 {accessKey, secretKey, region, endpoint, presignedExpiry}
 * @returns {Promise<string>} 预签名URL
 */
async function generatePresignedUrl(bucket, key, config) {
  try {
    console.log('generatePresignedUrl开始 - bucket:', bucket, 'key:', key);
    console.log('配置信息 - endpoint:', config.endpoint, 'region:', config.region, 'presignedExpiry:', config.presignedExpiry);
    
    const aws = new AwsClient({
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      region: config.region,
      service: 's3'
    });
    
    // 构建基础URL
    const baseUrl = `${config.endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    console.log('基础URL:', baseUrl);
    const url = new URL(baseUrl);
    
    // 设置过期时间（秒）
    const expirySeconds = (config.presignedExpiry || 3650) * 24 * 60 * 60;
    url.searchParams.set('X-Amz-Expires', expirySeconds.toString());
    console.log('过期时间（秒）:', expirySeconds);
    
    // 生成签名请求
    const signedRequest = await aws.sign(url.toString(), {
      method: 'GET',
      aws: { signQuery: true }
    });
    
    const finalUrl = signedRequest.url;
    console.log('生成的预签名URL:', finalUrl);
    console.log('URL长度:', finalUrl.length, '包含X-Amz-Signature:', finalUrl.includes('X-Amz-Signature'));
    
    return finalUrl;
  } catch (error) {
    console.error('生成预签名URL失败，使用简单URL', error);
    // 失败降级：返回简单URL
    try {
      const url = new URL(config.endpoint);
      return `${url.protocol}//${bucket}.${url.host}/${key}`;
    } catch (e) {
      return `${config.endpoint}/${bucket}/${key}`;
    }
  }
}

/**
 * 从URL下载图片为Blob
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<Blob>}
 */
export async function downloadImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status}`);
    }
    return await response.blob();
  } catch (error) {
    console.error('下载图片失败', error);
    throw error;
  }
}

/**
 * 处理网页中的图片（下载并上传到S3）
 * @param {Array<string>} imageUrls - 图片URL数组
 * @param {Object} s3Config - S3配置
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Map>} URL映射表 (原始URL -> S3 URL)
 */
export async function processImages(imageUrls, s3Config, onProgress = null) {
  const urlMap = new Map();
  
  if (!imageUrls || imageUrls.length === 0) {
    return urlMap;
  }
  
  const imageArray = [];
  
  // 下载所有图片
  for (const url of imageUrls) {
    try {
      const blob = await downloadImage(url);
      const filename = url.split('/').pop() || 'image.jpg';
      imageArray.push({ blob, filename, originalUrl: url });
    } catch (error) {
      console.error(`下载图片失败: ${url}`, error);
      // 下载失败的图片保留原链接
      urlMap.set(url, url);
    }
  }
  
  // 批量上传
  const results = await uploadImages(
    imageArray.map(item => ({ blob: item.blob, filename: item.filename })),
    s3Config,
    onProgress
  );
  
  // 构建URL映射
  imageArray.forEach((item, index) => {
    const result = results[index];
    if (result.success && result.url) {
      urlMap.set(item.originalUrl, result.url);
    } else {
      // 上传失败保留原链接
      urlMap.set(item.originalUrl, item.originalUrl);
    }
  });
  
  return urlMap;
}

/**
 * 替换Markdown中的图片URL
 * @param {string} markdown - Markdown文本
 * @param {Map} urlMap - URL映射表
 * @returns {string} 处理后的Markdown
 */
export function replaceImageUrls(markdown, urlMap) {
  let result = markdown;
  
  for (const [originalUrl, newUrl] of urlMap.entries()) {
    // 替换Markdown图片语法中的URL
    result = result.replace(
      new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(originalUrl)}\\)`, 'g'),
      `![$1](${newUrl})`
    );
  }
  
  return result;
}

/**
 * 转义正则表达式特殊字符
 * @param {string} str - 字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

