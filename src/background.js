/**
 * 后台服务脚本 (Service Worker)
 * 处理扩展安装、更新和上下文菜单
 */

import { initDefaultConfig, getConfig } from './utils/storage.js';
import { createNote, retryQueuedNote, summarizeContent } from './utils/api-client.js';
import { matchDomainTags, matchTemplate, replaceVariables } from './utils/template-matcher.js';
import { t, initI18nSystem } from './utils/i18n.js';
import { initDB, getQueue, updateItem, dequeue, getQueueSettings, shouldRetry, calculateRetryDelay, cleanup } from './utils/offline-queue.js';
import { htmlToMarkdown } from './utils/html-to-markdown.js';
import { processImages } from './utils/s3-uploader.js';

// 异步初始化 i18n
(async () => {
  await initI18nSystem();
  // 创建上下文菜单（需要在 i18n 初始化后）
  createContextMenus();
})();

// 扩展安装时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Blinko Extension Installed/Updated', details);
  
  if (details.reason === 'install') {
    // 首次安装
    console.log('First time installation, initializing default config...');
    await initDefaultConfig();
    
    // 打开设置页面
    chrome.runtime.openOptionsPage();
    
  } else if (details.reason === 'update') {
    // 更新
    const previousVersion = details.previousVersion;
    const currentVersion = chrome.runtime.getManifest().version;
    console.log(`Updated from ${previousVersion} to ${currentVersion}`);
    
    // 这里可以添加版本迁移逻辑
    await handleVersionMigration(previousVersion, currentVersion);
    
    // 菜单已在初始化时创建，这里不重复创建
  }
});

/**
 * 版本迁移处理
 * @param {string} fromVersion
 * @param {string} toVersion
 */
async function handleVersionMigration(fromVersion, toVersion) {
  console.log(`Migrating from ${fromVersion} to ${toVersion}`);
  
  // 示例：如果从1.0.0升级到1.1.0，添加新的默认配置
  // if (compareVersions(fromVersion, '1.0.0') === 0 && compareVersions(toVersion, '1.1.0') >= 0) {
  //   await saveConfig('new_feature_setting', true);
  // }
  
  // 当前版本没有特殊迁移需求
}

/**
 * 创建右键菜单
 */
async function createContextMenus() {
  // 移除现有菜单（使用Promise方式）
  await new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      resolve();
    });
  });
  
  // 创建父菜单
  chrome.contextMenus.create({
    id: 'blinko-parent',
    title: '📝 Blinko 剪藏',
    contexts: ['all']
  });
  
  // 快速保存分组
  chrome.contextMenus.create({
    id: 'save-selection-to-blinko',
    parentId: 'blinko-parent',
    title: t('context_menu_save_selection'),
    contexts: ['selection']
  });
  
  chrome.contextMenus.create({
    id: 'save-image-to-blinko',
    parentId: 'blinko-parent',
    title: t('context_menu_save_image'),
    contexts: ['image']
  });
  
  chrome.contextMenus.create({
    id: 'save-link-to-blinko',
    parentId: 'blinko-parent',
    title: t('context_menu_save_link'),
    contexts: ['link']
  });
  
  // 分隔符
  chrome.contextMenus.create({
    id: 'separator-1',
    parentId: 'blinko-parent',
    type: 'separator',
    contexts: ['page']
  });
  
  // 页面操作
  chrome.contextMenus.create({
    id: 'save-full-page',
    parentId: 'blinko-parent',
    title: t('context_menu_save_full_page'),
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'save-screenshot',
    parentId: 'blinko-parent',
    title: t('context_menu_save_screenshot'),
    contexts: ['page']
  });
  
  // 使用模板子菜单（等待父菜单创建完成）
  await createTemplateMenus();
}

/**
 * 创建模板子菜单
 */
async function createTemplateMenus() {
  try {
    const templates = await getConfig('templates', []);
    
    if (templates.length > 0) {
      // 添加小延迟，确保父菜单创建完成
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 分隔符
      chrome.contextMenus.create({
        id: 'separator-2',
        parentId: 'blinko-parent',
        type: 'separator',
        contexts: ['page']
      });
      
      // 使用模板父菜单
      chrome.contextMenus.create({
        id: 'use-template-parent',
        parentId: 'blinko-parent',
        title: t('context_menu_use_template'),
        contexts: ['page']
      });
      
      // 添加小延迟，确保use-template-parent创建完成
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 为每个模板创建子菜单项
      templates.forEach((template, index) => {
        // 确保template有id字段
        if (!template.id) {
          console.warn('[background] Template missing id:', template);
          return;
        }
        
        chrome.contextMenus.create({
          id: `use-template-${template.id}`,
          parentId: 'use-template-parent',
          title: `🎯 ${template.name}`,
          contexts: ['page']
        });
      });
    }
  } catch (error) {
    console.error('[background] Failed to create template menus:', error);
  }
}

// 监听模板配置变化，动态更新菜单
let isUpdatingMenus = false; // 防止重复更新
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.templates) {
    if (isUpdatingMenus) {
      console.log('[background] Menu update already in progress, skipping...');
      return;
    }
    
    isUpdatingMenus = true;
    console.log('[background] Templates changed, updating context menus...');
    
    try {
      await createContextMenus();
    } finally {
      isUpdatingMenus = false;
    }
  }
});

// 处理上下文菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const menuId = info.menuItemId;
    
    // 快速保存
    if (menuId === 'save-selection-to-blinko') {
      await handleSaveSelection(info, tab);
    } else if (menuId === 'save-image-to-blinko') {
      await handleSaveImage(info, tab);
    } else if (menuId === 'save-link-to-blinko') {
      await handleSaveLink(info, tab);
    } 
    // 页面操作
    else if (menuId === 'save-full-page') {
      await handleSaveFullPage(info, tab);
    } else if (menuId === 'save-screenshot') {
      await handleSaveScreenshot(info, tab);
    }
    // 使用模板
    else if (menuId.startsWith('use-template-')) {
      const templateId = menuId.replace('use-template-', '');
      await handleSaveWithTemplate(info, tab, templateId);
    }
  } catch (error) {
    console.error('Context menu action failed', error);
    showNotification(t('background_notification_error'), error.message, 'error');
  }
});

/**
 * 处理保存选中文本
 */
async function handleSaveSelection(info, tab) {
  let content = info.selectionText;
  
  if (!content || !content.trim()) {
    showNotification(t('background_notification_error'), t('background_notification_noSelection'), 'error');
    return;
  }
  
  // 是否包含链接
  const includeLink = await getConfig('include_link_selection', true);
  if (includeLink && tab) {
    content += `\n\n来源：[${tab.title}](${tab.url})`;
  }
  
  // 添加标签
  const tag = await getConfig('tag_selection', '#网页/划词');
  if (tag) {
    content += `\n\n${tag}`;
  }
  
  // 添加域名标签
  if (tab && tab.url) {
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(tab.url, domainTagRules, strategy);
    if (domainTags) {
      content += ` ${domainTags}`;
    }
  }
  
  // 保存到Blinko（带队列支持）
  const blinkoConfig = await getBlinkoConfig();
  const result = await createNote(
    blinkoConfig.apiUrl,
    blinkoConfig.authorization,
    content,
    0, // 默认为闪念
    { source: 'context-menu-selection', url: tab.url, title: tab.title }
  );
  
  if (result.success) {
    showNotification(t('background_notification_saveSuccess'), t('background_notification_selectionSaved'), 'success');
  } else if (result.queued) {
    showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
  } else {
    showNotification(t('background_notification_saveFailed'), result.message, 'error');
  }
}

/**
 * 处理保存图片
 */
async function handleSaveImage(info, tab) {
  const imageUrl = info.srcUrl;
  
  if (!imageUrl) {
    showNotification(t('background_notification_error'), t('background_notification_noImageUrl'), 'error');
    return;
  }
  
  let content = `![图片](${imageUrl})`;
  
  // 是否包含链接
  const includeLink = await getConfig('include_link_image', true);
  if (includeLink && tab) {
    content += `\n\n来源：[${tab.title}](${tab.url})`;
  }
  
  // 添加标签
  const tag = await getConfig('tag_image', '#网页/图片');
  if (tag) {
    content += `\n\n${tag}`;
  }
  
  // 添加域名标签
  if (tab && tab.url) {
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(tab.url, domainTagRules, strategy);
    if (domainTags) {
      content += ` ${domainTags}`;
    }
  }
  
  // 保存到Blinko（带队列支持）
  const blinkoConfig = await getBlinkoConfig();
  const result = await createNote(
    blinkoConfig.apiUrl,
    blinkoConfig.authorization,
    content,
    0,
    { source: 'context-menu-image', url: tab.url, title: tab.title }
  );
  
  if (result.success) {
    showNotification(t('background_notification_saveSuccess'), t('background_notification_imageSaved'), 'success');
  } else if (result.queued) {
    showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
  } else {
    showNotification(t('background_notification_saveFailed'), result.message, 'error');
  }
}

/**
 * 处理保存链接
 */
async function handleSaveLink(info, tab) {
  const linkUrl = info.linkUrl;
  const linkText = info.selectionText || linkUrl;
  
  if (!linkUrl) {
    showNotification(t('background_notification_error'), t('background_notification_noLinkUrl'), 'error');
    return;
  }
  
  let content = `[${linkText}](${linkUrl})`;
  
  // 添加来源页面
  if (tab) {
    content += `\n\n来自页面：[${tab.title}](${tab.url})`;
  }
  
  // 保存到Blinko（带队列支持）
  const blinkoConfig = await getBlinkoConfig();
  const result = await createNote(
    blinkoConfig.apiUrl,
    blinkoConfig.authorization,
    content,
    0,
    { source: 'context-menu-link', url: tab.url, title: tab.title }
  );
  
  if (result.success) {
    showNotification(t('background_notification_saveSuccess'), t('background_notification_linkSaved'), 'success');
  } else if (result.queued) {
    showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
  } else {
    showNotification(t('background_notification_saveFailed'), result.message, 'error');
  }
}

/**
 * 处理保存整个页面
 */
async function handleSaveFullPage(info, tab) {
  try {
    showNotification(t('background_notification_processing'), t('context_menu_extracting_page'), 'info');
    
    // 向content script发送消息提取页面内容
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'extract-content'
    });
    
    if (!response || !response.html) {
      throw new Error('无法提取页面内容');
    }
    
    // 转换为Markdown
    const { markdown } = htmlToMarkdown(response.html, false);
    
    let content = `# ${tab.title}\n\n${markdown}`;
    content += `\n\n来源：[${tab.title}](${tab.url})`;
    
    // 添加场景标签
    const tag = await getConfig('tag_full_page', '#网页/全文');
    if (tag) {
      content += `\n\n${tag}`;
    }
    
    // 添加域名标签
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(tab.url, domainTagRules, strategy);
    if (domainTags) {
      content += ` ${domainTags}`;
    }
    
    // 保存到Blinko
    const blinkoConfig = await getBlinkoConfig();
    const result = await createNote(
      blinkoConfig.apiUrl,
      blinkoConfig.authorization,
      content,
      1, // 笔记类型
      { source: 'context-menu-full-page', url: tab.url, title: tab.title }
    );
    
    if (result.success) {
      showNotification(t('background_notification_saveSuccess'), t('context_menu_full_page_saved'), 'success');
    } else if (result.queued) {
      showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
    } else {
      showNotification(t('background_notification_saveFailed'), result.message, 'error');
    }
  } catch (error) {
    console.error('[background] Save full page failed:', error);
    showNotification(t('background_notification_error'), error.message, 'error');
  }
}

/**
 * 处理保存页面截图
 */
async function handleSaveScreenshot(info, tab) {
  try {
    showNotification(t('background_notification_processing'), t('context_menu_capturing_screenshot'), 'info');
    
    // 捕获当前可视区域截图
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 95
    });
    
    let content = '';
    
    // 检查是否配置了S3
    const s3Config = await getS3Config();
    const hasS3 = s3Config.accessKey && s3Config.bucket && s3Config.endpoint;
    
    if (hasS3) {
      try {
        // 上传到S3
        const timestamp = Date.now();
        const filename = `screenshot-${timestamp}.png`;
        const urlMap = await processImages([dataUrl], s3Config);
        
        if (urlMap && urlMap[dataUrl]) {
          content = `![Screenshot](${urlMap[dataUrl]})`;
        } else {
          // S3上传失败，降级使用DataURL
          content = `![Screenshot](${dataUrl})`;
          console.warn('[background] S3 upload failed, using DataURL');
        }
      } catch (s3Error) {
        console.error('[background] S3 upload error:', s3Error);
        content = `![Screenshot](${dataUrl})`;
      }
    } else {
      // 未配置S3，使用DataURL
      content = `![Screenshot](${dataUrl})`;
    }
    
    content += `\n\n来源：[${tab.title}](${tab.url})`;
    
    // 添加场景标签
    const tag = await getConfig('tag_screenshot', '#网页/截图');
    if (tag) {
      content += `\n\n${tag}`;
    }
    
    // 添加域名标签
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(tab.url, domainTagRules, strategy);
    if (domainTags) {
      content += ` ${domainTags}`;
    }
    
    // 保存到Blinko
    const blinkoConfig = await getBlinkoConfig();
    const result = await createNote(
      blinkoConfig.apiUrl,
      blinkoConfig.authorization,
      content,
      1, // 笔记类型
      { source: 'context-menu-screenshot', url: tab.url, title: tab.title }
    );
    
    if (result.success) {
      showNotification(t('background_notification_saveSuccess'), t('context_menu_screenshot_saved'), 'success');
    } else if (result.queued) {
      showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
    } else {
      showNotification(t('background_notification_saveFailed'), result.message, 'error');
    }
  } catch (error) {
    console.error('[background] Save screenshot failed:', error);
    
    // 特殊页面错误处理
    if (error.message && error.message.includes('cannot be captured')) {
      showNotification(t('background_notification_error'), t('context_menu_screenshot_not_supported'), 'error');
    } else {
      showNotification(t('background_notification_error'), error.message, 'error');
    }
  }
}

/**
 * 处理使用模板保存
 */
async function handleSaveWithTemplate(info, tab, templateId) {
  try {
    // 获取模板
    const templates = await getConfig('templates', []);
    const template = templates.find(t => t.id === templateId);
    
    if (!template) {
      throw new Error('模板不存在');
    }
    
    showNotification(t('background_notification_processing'), `正在使用【${template.name}】处理...`, 'info');
    
    // 提取页面内容
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'extract-content'
    });
    
    if (!response || !response.html) {
      throw new Error('无法提取页面内容');
    }
    
    const { markdown } = htmlToMarkdown(response.html, false);
    
    // 使用模板总结
    const openaiConfig = await getOpenAIConfig();
    const summaryResult = await summarizeContent(
      openaiConfig.baseUrl,
      openaiConfig.apiKey,
      openaiConfig.model,
      template.content, // 模板作为system prompt
      markdown
    );
    
    if (!summaryResult.success) {
      throw new Error(summaryResult.message);
    }
    
    let content = summaryResult.summary;
    content += `\n\n来源：[${tab.title}](${tab.url})`;
    
    // 添加域名标签
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(tab.url, domainTagRules, strategy);
    if (domainTags) {
      content += `\n\n${domainTags}`;
    }
    
    // 保存到Blinko
    const blinkoConfig = await getBlinkoConfig();
    const result = await createNote(
      blinkoConfig.apiUrl,
      blinkoConfig.authorization,
      content,
      1, // 笔记类型
      { source: 'context-menu-template', templateId, url: tab.url, title: tab.title }
    );
    
    if (result.success) {
      showNotification(t('background_notification_saveSuccess'), `使用【${template.name}】保存成功`, 'success');
    } else if (result.queued) {
      showNotification(t('background_notification_queued'), t('background_notification_willRetry'), 'info');
    } else {
      showNotification(t('background_notification_saveFailed'), result.message, 'error');
    }
  } catch (error) {
    console.error('[background] Save with template failed:', error);
    showNotification(t('background_notification_error'), error.message, 'error');
  }
}

/**
 * 获取S3配置
 */
async function getS3Config() {
  return {
    accessKey: await getConfig('s3_access_key', ''),
    secretKey: await getConfig('s3_secret_key', ''),
    endpoint: await getConfig('s3_endpoint', ''),
    region: await getConfig('s3_region', ''),
    bucket: await getConfig('s3_bucket', ''),
    cdn: await getConfig('s3_cdn', ''),
    customPath: await getConfig('s3_custom_path', ''),
    acl: await getConfig('s3_acl', 'public'),
    presignedExpiry: await getConfig('s3_presigned_expiry', 3650)
  };
}

/**
 * 获取OpenAI配置
 */
async function getOpenAIConfig() {
  return {
    baseUrl: await getConfig('openai_base_url', 'https://api.openai.com/v1'),
    apiKey: await getConfig('openai_key', ''),
    model: await getConfig('openai_model', 'gpt-3.5-turbo')
  };
}

/**
 * 获取Blinko配置
 */
async function getBlinkoConfig() {
  return {
    apiUrl: await getConfig('blinko_api_url', ''),
    authorization: await getConfig('blinko_authorization', '')
  };
}

/**
 * 显示通知
 */
function showNotification(title, message, type = 'info') {
  const iconUrl = type === 'success' 
    ? 'icons/icon48.png' 
    : 'icons/icon48.png';
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconUrl,
    title: title,
    message: message,
    priority: 2
  });
}

/**
 * 比较版本号
 * @returns {number} -1: v1 < v2, 0: v1 === v2, 1: v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

// 监听来自content script或popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 这里可以添加需要后台处理的消息
  if (request.action === 'log') {
    console.log('Background log:', request.message);
    sendResponse({ success: true });
  }
  
  return true; // 保持消息通道开放
});

// 初始化离线队列处理
(async () => {
  await initOfflineQueueProcessing();
})();

/**
 * 初始化离线队列处理
 */
async function initOfflineQueueProcessing() {
  try {
    console.log('[background] Initializing offline queue processing...');
    
    // 初始化数据库
    await initDB();
    
    // 检查并处理pending/retrying的项
    await processQueueOnStartup();
    
    // 监听网络状态变化
    setupNetworkListeners();
    
    // 设置定期检查
    setupPeriodicCheck();
    
    // 设置定期清理
    setupPeriodicCleanup();
    
    console.log('[background] Offline queue processing initialized');
  } catch (error) {
    console.error('[background] Failed to initialize offline queue:', error);
  }
}

/**
 * 启动时处理队列
 */
async function processQueueOnStartup() {
  try {
    const queue = await getQueue('all');
    const pendingItems = queue.filter(item => 
      item.status === 'pending' || item.status === 'retrying'
    );
    
    if (pendingItems.length > 0) {
      console.log(`[background] Found ${pendingItems.length} pending items, starting retry...`);
      
      // 逐个重试
      for (const item of pendingItems) {
        await retryQueueItem(item);
      }
    }
  } catch (error) {
    console.error('[background] Error processing queue on startup:', error);
  }
}

/**
 * 重试队列项
 */
async function retryQueueItem(item) {
  try {
    const settings = await getQueueSettings();
    
    // 检查是否应该继续重试
    if (!shouldRetry(item.retryCount, settings.retryStrategy)) {
      console.log(`[background] Max retries reached for item ${item.id}`);
      await updateItem(item.id, {
        status: 'failed',
        lastError: '达到最大重试次数'
      });
      return;
    }
    
    // 更新状态为重试中
    await updateItem(item.id, {
      status: 'retrying'
    });
    
    // 获取Blinko配置并重试
    const blinkoConfig = await getBlinkoConfig();
    const result = await retryQueuedNote(item, blinkoConfig.apiUrl, blinkoConfig.authorization);
    
    if (result.success) {
      // 成功 - 标记为成功，稍后清理
      await updateItem(item.id, {
        status: 'success',
        lastError: ''
      });
      console.log(`[background] Successfully retried item ${item.id}`);
    } else {
      // 失败 - 增加重试次数，计算下次重试时间
      const newRetryCount = item.retryCount + 1;
      await updateItem(item.id, {
        status: 'pending',
        retryCount: newRetryCount,
        lastError: result.message
      });
      
      // 计算下次重试延迟
      const delay = calculateRetryDelay(newRetryCount, settings.retryStrategy);
      console.log(`[background] Retry failed for item ${item.id}, will retry in ${delay}ms`);
      
      // 安排下次重试
      setTimeout(() => retryQueueItem(item), delay);
    }
  } catch (error) {
    console.error(`[background] Error retrying item ${item.id}:`, error);
    await updateItem(item.id, {
      status: 'failed',
      lastError: error.message
    });
  }
}

/**
 * 设置网络状态监听
 */
function setupNetworkListeners() {
  // Service Worker中的网络状态监听
  // 注意：Service Worker中navigator.onLine可能不可靠
  // 我们使用chrome.runtime.onConnect来检测popup/options页面的连接
  
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'network-status') {
      port.onMessage.addListener(async (msg) => {
        if (msg.type === 'network-online') {
          console.log('[background] Network online, processing queue...');
          await processQueueOnStartup();
        }
      });
    }
  });
}

/**
 * 设置定期检查（每5分钟）
 */
function setupPeriodicCheck() {
  chrome.alarms.create('check-queue', {
    periodInMinutes: 5
  });
  
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'check-queue') {
      console.log('[background] Periodic queue check triggered');
      await processQueueOnStartup();
    }
  });
}

/**
 * 设置定期清理（每小时）
 */
function setupPeriodicCleanup() {
  chrome.alarms.create('cleanup-queue', {
    periodInMinutes: 60
  });
  
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanup-queue') {
      console.log('[background] Periodic cleanup triggered');
      const removed = await cleanup();
      console.log(`[background] Cleaned up ${removed} items`);
    }
  });
}

// Service Worker启动时的日志
console.log('Blinko Background Service Worker Started');



