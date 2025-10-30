/**
 * 内容脚本
 * 在网页中运行，提取页面内容
 */

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract-content') {
    try {
      const html = extractPageContent();
      sendResponse({ success: true, html: html });
    } catch (error) {
      console.error('提取内容失败', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'extract-images') {
    try {
      const images = extractImages();
      sendResponse({ success: true, images: images });
    } catch (error) {
      console.error('提取图片失败', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
  
  if (request.action === 'trigger-lazy-load') {
    // 异步处理懒加载触发
    (async () => {
      try {
        const config = {
          speed: request.speed || 'medium',
          maxWait: request.maxWait || 10
        };
        
        // 进度回调函数（由于Chrome消息限制，暂不实现实时进度）
        const result = await triggerLazyLoadImages(config);
        sendResponse(result);
      } catch (error) {
        console.error('懒加载触发失败', error);
        sendResponse({
          success: false,
          triggered: false,
          imageCount: 0,
          message: error.message
        });
      }
    })();
    
    return true; // 保持消息通道开放以支持异步响应
  }
});

/**
 * 提取页面主要内容
 * @returns {string} HTML字符串
 */
function extractPageContent() {
  // 尝试找到主要内容区域
  const mainContent = findMainContent();
  
  if (mainContent) {
    return mainContent.innerHTML;
  }
  
  // 如果找不到主要内容，返回body内容
  return document.body.innerHTML;
}

/**
 * 查找主要内容区域
 * @returns {Element|null}
 */
function findMainContent() {
  // 优先级选择器列表
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.main-content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#content',
    '.content',
    '#main',
    '.main'
  ];
  
  // 尝试每个选择器
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && hasSubstantialContent(element)) {
      return cleanElement(element.cloneNode(true));
    }
  }
  
  // 如果上述选择器都失败，尝试启发式方法
  return findContentByHeuristic();
}

/**
 * 检查元素是否包含实质性内容
 * @param {Element} element
 * @returns {boolean}
 */
function hasSubstantialContent(element) {
  const text = element.textContent.trim();
  const wordCount = text.split(/\s+/).length;
  return wordCount > 100; // 至少100个词
}

/**
 * 启发式查找内容
 * @returns {Element|null}
 */
function findContentByHeuristic() {
  // 找到所有文本密度高的元素
  const candidates = [];
  const allElements = document.body.querySelectorAll('div, section, article');
  
  allElements.forEach(element => {
    // 跳过导航、侧边栏等
    const classAndId = (element.className + ' ' + element.id).toLowerCase();
    if (classAndId.match(/(nav|sidebar|footer|header|menu|advertisement|ad-)/)) {
      return;
    }
    
    // 计算文本密度
    const text = element.textContent.trim();
    const wordCount = text.split(/\s+/).length;
    
    if (wordCount > 100) {
      candidates.push({
        element: element,
        wordCount: wordCount,
        linkDensity: calculateLinkDensity(element)
      });
    }
  });
  
  // 选择词数最多且链接密度低的元素
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      // 优先选择链接密度低的
      if (Math.abs(a.linkDensity - b.linkDensity) > 0.1) {
        return a.linkDensity - b.linkDensity;
      }
      // 然后按词数排序
      return b.wordCount - a.wordCount;
    });
    
    return cleanElement(candidates[0].element.cloneNode(true));
  }
  
  return null;
}

/**
 * 计算元素的链接密度
 * @param {Element} element
 * @returns {number} 0-1之间的值
 */
function calculateLinkDensity(element) {
  const totalText = element.textContent.length;
  if (totalText === 0) return 1;
  
  const links = element.querySelectorAll('a');
  let linkText = 0;
  links.forEach(link => {
    linkText += link.textContent.length;
  });
  
  return linkText / totalText;
}

/**
 * 清理元素，移除无用内容
 * @param {Element} element
 * @returns {Element}
 */
function cleanElement(element) {
  // 移除脚本、样式等
  const unwantedSelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'object',
    'embed',
    '.advertisement',
    '.ads',
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.social-share',
    '.share-buttons',
    'nav',
    'header',
    'footer',
    'aside'
  ];
  
  unwantedSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  // 转换相对URL为绝对URL
  convertRelativeUrls(element);
  
  return element;
}

/**
 * 转换相对URL为绝对URL
 * @param {Element} element
 */
function convertRelativeUrls(element) {
  // 处理图片
  element.querySelectorAll('img').forEach(img => {
    if (img.src) {
      img.src = new URL(img.src, window.location.href).href;
    }
    if (img.dataset.src) {
      img.dataset.src = new URL(img.dataset.src, window.location.href).href;
    }
  });
  
  // 处理链接
  element.querySelectorAll('a').forEach(link => {
    if (link.href) {
      link.href = new URL(link.href, window.location.href).href;
    }
  });
}

/**
 * 提取页面所有图片
 * @returns {Array<string>} 图片URL数组
 */
function extractImages() {
  const images = [];
  const seen = new Set();
  
  document.querySelectorAll('img').forEach(img => {
    let src = img.src || img.dataset.src;
    
    if (!src) return;
    
    // 转换为绝对URL
    try {
      src = new URL(src, window.location.href).href;
    } catch (e) {
      return;
    }
    
    // 过滤无效图片
    if (src.startsWith('data:')) return; // 跳过data URI
    if (src.length > 2000) return; // URL过长可能是data URI
    if (seen.has(src)) return; // 跳过重复
    
    // 过滤小图片（通常是图标）
    if (img.naturalWidth && img.naturalWidth < 50) return;
    if (img.naturalHeight && img.naturalHeight < 50) return;
    
    seen.add(src);
    images.push(src);
  });
  
  return images;
}

/**
 * 获取页面标题
 * @returns {string}
 */
function getPageTitle() {
  // 尝试多种方式获取标题
  const candidates = [
    document.querySelector('h1'),
    document.querySelector('[property="og:title"]'),
    document.querySelector('[name="title"]'),
    document.querySelector('title')
  ];
  
  for (const element of candidates) {
    if (element) {
      const title = element.content || element.textContent;
      if (title && title.trim()) {
        return title.trim();
      }
    }
  }
  
  return document.title || '';
}

/**
 * 获取页面描述
 * @returns {string}
 */
function getPageDescription() {
  const metaDesc = document.querySelector('[name="description"]') || 
                   document.querySelector('[property="og:description"]');
  
  if (metaDesc) {
    return metaDesc.content || '';
  }
  
  // 尝试从第一段获取
  const firstParagraph = document.querySelector('article p, main p, .content p');
  if (firstParagraph) {
    return firstParagraph.textContent.trim().substring(0, 200);
  }
  
  return '';
}

// 页面加载完成时的初始化
console.log('Blinko Content Script Loaded');

/**
 * 检测页面中的懒加载图片
 * @returns {NodeList} 懒加载图片元素列表
 */
function detectLazyLoadImages() {
  const lazyImages = document.querySelectorAll(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'
  );
  return lazyImages;
}

/**
 * 根据速度配置获取滚动参数
 * @param {string} speed - 速度配置: 'fast', 'medium', 'slow'
 * @returns {Object} { scrollStep, waitTime }
 */
function getScrollParams(speed) {
  const viewportHeight = window.innerHeight;
  
  switch (speed) {
    case 'fast':
      return {
        scrollStep: viewportHeight,
        waitTime: 200
      };
    case 'slow':
      return {
        scrollStep: viewportHeight * 0.6,
        waitTime: 500
      };
    case 'medium':
    default:
      return {
        scrollStep: viewportHeight * 0.8,
        waitTime: 300
      };
  }
}

/**
 * 睡眠函数
 * @param {number} ms - 毫秒数
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 触发懒加载图片
 * @param {Object} config - 配置对象
 * @param {string} config.speed - 滚动速度
 * @param {number} config.maxWait - 最大等待时间（秒）
 * @param {Function} progressCallback - 进度回调函数
 * @returns {Promise<Object>} 结果对象
 */
async function triggerLazyLoadImages(config, progressCallback) {
  try {
    // 1. 检测是否有懒加载图片
    const lazyImages = detectLazyLoadImages();
    if (lazyImages.length === 0) {
      console.log('未检测到懒加载图片，跳过滚动触发');
      return {
        success: true,
        triggered: false,
        imageCount: 0,
        message: '未检测到懒加载图片'
      };
    }
    
    console.log(`检测到 ${lazyImages.length} 个懒加载图片，开始触发...`);
    
    // 2. 记录原始滚动位置
    const originalScrollY = window.scrollY;
    
    // 3. 获取滚动参数
    const { scrollStep, waitTime } = getScrollParams(config.speed || 'medium');
    const maxWaitMs = (config.maxWait || 10) * 1000;
    const startTime = Date.now();
    
    // 4. 计算总高度和分段数
    const documentHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const totalSteps = Math.ceil(documentHeight / scrollStep);
    let currentStep = 0;
    
    // 5. 分段滚动
    for (let pos = 0; pos < documentHeight; pos += scrollStep) {
      // 检查是否超时
      if (Date.now() - startTime > maxWaitMs) {
        console.log('懒加载触发超时，停止滚动');
        break;
      }
      
      currentStep++;
      
      // 滚动到指定位置
      window.scrollTo({ top: pos, behavior: 'smooth' });
      
      // 报告进度
      if (progressCallback) {
        progressCallback(currentStep, totalSteps);
      }
      
      // 等待图片加载
      await sleep(waitTime);
    }
    
    // 6. 额外等待1秒确保最后一批图片加载
    await sleep(1000);
    
    // 7. 恢复原始位置
    window.scrollTo({ top: originalScrollY, behavior: 'smooth' });
    await sleep(300); // 等待滚动动画完成
    
    console.log('懒加载触发完成');
    
    return {
      success: true,
      triggered: true,
      imageCount: lazyImages.length,
      message: `成功触发 ${lazyImages.length} 个懒加载图片`
    };
    
  } catch (error) {
    console.error('懒加载触发失败', error);
    return {
      success: false,
      triggered: false,
      imageCount: 0,
      message: error.message
    };
  }
}



