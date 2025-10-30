/**
 * 弹出窗口逻辑
 */

import { getConfig } from './utils/storage.js';
import { htmlToMarkdown } from './utils/html-to-markdown.js';
import { createNote, summarizeContent } from './utils/api-client.js';
import { processImages, replaceImageUrls } from './utils/s3-uploader.js';
import { matchTemplate, replaceVariables, matchDomainTags } from './utils/template-matcher.js';
import { t, initI18nSystem, initI18n } from './utils/i18n.js';
import { saveDraft, loadDraft, clearDraft, saveNamedDraft, listDrafts, deleteDraft, getDraftSettings } from './utils/draft-manager.js';

// 异步初始化国际化
(async () => {
  await initI18nSystem();
  initI18n();
})();

// Tab切换
document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => {
    const targetTab = button.dataset.tab;
    
    // 设置Tab直接跳转到设置页面
    if (targetTab === 'settings') {
      chrome.runtime.openOptionsPage();
      return;
    }
    
    switchTab(targetTab);
  });
});

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  // 速写Tab自动聚焦
  if (tabName === 'quick-note') {
    setTimeout(() => {
      document.getElementById('quick-note-content').focus();
    }, 100);
  }
}

// ========== Tab 1: 剪藏 ==========
const extractContentBtn = document.getElementById('extract-content');
const extractAndSummarizeBtn = document.getElementById('extract-and-summarize');
const previewContent = document.getElementById('preview-content');
const clearPreviewBtn = document.getElementById('clear-preview');
const submitClippingBtn = document.getElementById('submit-clipping');
const clippingStatus = document.getElementById('clipping-status');

let currentPageUrl = '';
let currentPageTitle = '';

// 获取当前页面信息
async function getCurrentPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentPageUrl = tab.url;
    currentPageTitle = tab.title;
    return { url: tab.url, title: tab.title, tabId: tab.id };
  }
  return null;
}

// 提取网页正文
extractContentBtn.addEventListener('click', async () => {
  try {
    const pageInfo = await getCurrentPageInfo();
    if (!pageInfo) {
      throw new Error(t('status_error_noPageInfo'));
    }
    
    // 获取懒加载配置
    const lazyLoadConfig = await getLazyLoadConfig();
    
    // 如果启用懒加载触发，先触发
    if (lazyLoadConfig.enabled) {
      try {
        showLoading(t('status_loading_lazyLoad'));
        
        const lazyLoadResult = await chrome.tabs.sendMessage(pageInfo.tabId, {
          action: 'trigger-lazy-load',
          speed: lazyLoadConfig.speed,
          maxWait: lazyLoadConfig.maxWait
        });
        
        if (lazyLoadResult && lazyLoadResult.triggered) {
          console.log(`懒加载触发成功: ${lazyLoadResult.message}`);
        }
      } catch (lazyLoadError) {
        // 懒加载触发失败不影响正常提取，记录错误后继续
        console.warn('懒加载触发失败，继续提取内容', lazyLoadError);
      }
    }
    
    showLoading(t('status_loading_extracting'));
    
    // 向content script发送消息提取HTML
    const response = await chrome.tabs.sendMessage(pageInfo.tabId, {
      action: 'extract-content'
    });
    
    if (!response || !response.html) {
      throw new Error(t('status_error_noPageInfo'));
    }
    
    // 转换为Markdown
    const { markdown, images } = htmlToMarkdown(response.html, true);
    
    // 处理图片
    const keepOriginal = await getConfig('keep_original_image_link', true);
    let finalMarkdown = markdown;
    
    if (!keepOriginal && images.length > 0) {
      showLoading(`正在处理图片 (0/${images.length})...`);
      
      const s3Config = await getS3Config();
      console.log('Popup获取到的S3配置:', JSON.stringify({
        acl: s3Config.acl,
        presignedExpiry: s3Config.presignedExpiry,
        bucket: s3Config.bucket,
        cdn: s3Config.cdn
      }));
      const urlMap = await processImages(images, s3Config, (current, total) => {
        showLoading(t('status_loading_processingImages', current.toString(), total.toString()));
      });
      
      finalMarkdown = replaceImageUrls(markdown, urlMap);
    }
    
    // 添加网页链接（如果配置了）
    const includeLink = await getConfig('include_link_summary', true);
    if (includeLink) {
      finalMarkdown += `\n\n来源：[${pageInfo.title}](${pageInfo.url})`;
    }
    
    // 添加场景标签
    const tag = await getConfig('tag_clipping', '#网页/剪藏');
    if (tag) {
      finalMarkdown += `\n\n${tag}`;
    }
    
    // 添加域名标签
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(pageInfo.url, domainTagRules, strategy);
    if (domainTags) {
      finalMarkdown += ` ${domainTags}`;
    }
    
    previewContent.value = finalMarkdown;
    hideLoading();
    showStatus(clippingStatus, 'success', t('status_success_extracted'));
    
  } catch (error) {
    hideLoading();
    console.error('提取失败', error);
    showStatus(clippingStatus, 'error', t('status_error_extractFailed', error.message));
  }
});

// 提取并总结
extractAndSummarizeBtn.addEventListener('click', async () => {
  try {
    const pageInfo = await getCurrentPageInfo();
    if (!pageInfo) {
      throw new Error(t('status_error_noPageInfo'));
    }
    
    // 获取懒加载配置
    const lazyLoadConfig = await getLazyLoadConfig();
    
    // 如果启用懒加载触发，先触发
    if (lazyLoadConfig.enabled) {
      try {
        showLoading(t('status_loading_lazyLoad'));
        
        const lazyLoadResult = await chrome.tabs.sendMessage(pageInfo.tabId, {
          action: 'trigger-lazy-load',
          speed: lazyLoadConfig.speed,
          maxWait: lazyLoadConfig.maxWait
        });
        
        if (lazyLoadResult && lazyLoadResult.triggered) {
          console.log(`懒加载触发成功: ${lazyLoadResult.message}`);
        }
      } catch (lazyLoadError) {
        // 懒加载触发失败不影响正常提取，记录错误后继续
        console.warn('懒加载触发失败，继续提取内容', lazyLoadError);
      }
    }
    
    showLoading(t('status_loading_extracting'));
    
    // 提取HTML
    const response = await chrome.tabs.sendMessage(pageInfo.tabId, {
      action: 'extract-content'
    });
    
    if (!response || !response.html) {
      throw new Error(t('status_error_noPageInfo'));
    }
    
    // 转换为Markdown（不包含图片）
    const { markdown } = htmlToMarkdown(response.html, false);
    
    if (!markdown || markdown.trim().length < 100) {
      throw new Error(t('status_error_contentTooShort'));
    }
    
    showLoading(t('status_loading_summarizing'));
    
    // 获取OpenAI配置
    const openaiConfig = await getOpenAIConfig();
    if (!openaiConfig.apiKey) {
      throw new Error(t('status_error_noOpenAIConfig'));
    }
    
    // 匹配模板
    const templates = await getConfig('templates', []);
    const domainRules = await getConfig('domain_rules', []);
    const defaultTemplate = await getConfig('default_template', '');
    
    const template = matchTemplate(pageInfo.url, templates, domainRules, defaultTemplate);
    const { systemPrompt, userPrompt } = replaceVariables(template.content, markdown);
    
    // 调用AI总结
    const result = await summarizeContent(
      openaiConfig.baseUrl,
      openaiConfig.apiKey,
      openaiConfig.model,
      systemPrompt,
      userPrompt
    );
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    let summary = result.summary;
    
    // 添加网页链接（如果配置了）
    const includeLink = await getConfig('include_link_summary', true);
    if (includeLink) {
      summary += `\n\n来源：[${pageInfo.title}](${pageInfo.url})`;
    }
    
    // 添加场景标签
    const tag = await getConfig('tag_summary', '#网页/总结');
    if (tag) {
      summary += `\n\n${tag}`;
    }
    
    // 添加域名标签
    const domainTagRules = await getConfig('domain_tag_rules', []);
    const strategy = await getConfig('domain_tag_match_strategy', 'first');
    const domainTags = matchDomainTags(pageInfo.url, domainTagRules, strategy);
    if (domainTags) {
      summary += ` ${domainTags}`;
    }
    
    previewContent.value = summary;
    hideLoading();
    showStatus(clippingStatus, 'success', t('status_success_summarized'));
    
  } catch (error) {
    hideLoading();
    console.error('总结失败', error);
    showStatus(clippingStatus, 'error', t('status_error_summarizeFailed', error.message));
  }
});

// 清空预览
clearPreviewBtn.addEventListener('click', () => {
  previewContent.value = '';
  showStatus(clippingStatus, 'info', t('status_success_cleared'));
});

// 提交剪藏
submitClippingBtn.addEventListener('click', async () => {
  try {
    const content = previewContent.value.trim();
    if (!content) {
      showStatus(clippingStatus, 'error', t('status_error_emptyContent'));
      return;
    }
    
    showLoading(t('status_loading_saving'));
    
    const blinkoConfig = await getBlinkoConfig();
    const typeElement = document.querySelector('input[name="clipping-type"]:checked');
    const type = typeElement ? parseInt(typeElement.value) : 0;
    
    const result = await createNote(
      blinkoConfig.apiUrl,
      blinkoConfig.authorization,
      content,
      type
    );
    
    if (result.success) {
      previewContent.value = '';
      hideLoading();
      showStatus(clippingStatus, 'success', t('status_success_saved'));
    } else {
      hideLoading();
      showStatus(clippingStatus, 'error', result.message);
    }
    
  } catch (error) {
    hideLoading();
    showStatus(clippingStatus, 'error', t('status_error_saveFailed', error.message));
  }
});

// ========== Tab 2: 速写 ==========
const quickNoteContent = document.getElementById('quick-note-content');
const clearQuickNoteBtn = document.getElementById('clear-quick-note');
const submitQuickNoteBtn = document.getElementById('submit-quick-note');
const quickNoteStatus = document.getElementById('quick-note-status');

// 草稿相关元素
const draftRestoreBanner = document.getElementById('draft-restore-banner');
const restoreDraftBtn = document.getElementById('restore-draft-btn');
const ignoreDraftBtn = document.getElementById('ignore-draft-btn');
const saveDraftBtn = document.getElementById('save-draft-btn');
const manageDraftsBtn = document.getElementById('manage-drafts-btn');
const autoSaveIndicator = document.getElementById('auto-save-indicator');
const draftTimestamp = document.getElementById('draft-timestamp');

// 草稿模态框元素
const draftManagerModal = document.getElementById('draft-manager-modal');
const closeDraftManagerBtn = document.getElementById('close-draft-manager');
const closeDraftManagerFooterBtn = document.getElementById('close-draft-manager-btn');
const draftsList = document.getElementById('drafts-list');
const emptyDraftsMessage = document.getElementById('empty-drafts-message');

// 自动保存定时器
let autoSaveTimeout = null;

// 初始化草稿功能
async function initDraftFeature() {
  // 检查是否有未完成的草稿
  const draft = await loadDraft();
  if (draft) {
    showDraftRestoreBanner(draft);
  }

  // 监听输入变化，自动保存
  const settings = await getDraftSettings();
  const interval = settings.autoSaveInterval || 2000;

  quickNoteContent.addEventListener('input', () => {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
      await autoSaveDraft();
    }, interval);
  });

  // 窗口关闭前保存
  window.addEventListener('beforeunload', async () => {
    await autoSaveDraft(true);
  });
}

// 自动保存草稿
async function autoSaveDraft(immediate = false) {
  const content = quickNoteContent.value.trim();
  if (!content) {
    return;
  }

  const typeElement = document.querySelector('input[name="quick-note-type"]:checked');
  const type = typeElement ? parseInt(typeElement.value) : 0;

  const success = await saveDraft(content, type);
  if (success && !immediate) {
    showAutoSaveIndicator();
  }
}

// 显示自动保存指示器
function showAutoSaveIndicator() {
  autoSaveIndicator.style.display = 'flex';
  setTimeout(() => {
    autoSaveIndicator.style.display = 'none';
  }, 2000);
}

// 显示草稿恢复提示条
function showDraftRestoreBanner(draft) {
  const now = Date.now();
  const diff = now - draft.timestamp;
  const minutes = Math.floor(diff / 60000);
  const timeText = minutes < 1 ? t('draft_just_now') : t('draft_minutes_ago', minutes.toString());
  
  draftTimestamp.textContent = `(${timeText})`;
  draftRestoreBanner.style.display = 'flex';
}

// 恢复草稿
restoreDraftBtn.addEventListener('click', async () => {
  const draft = await loadDraft();
  if (draft) {
    quickNoteContent.value = draft.content;
    
    // 恢复笔记类型
    const typeRadio = document.querySelector(`input[name="quick-note-type"][value="${draft.type}"]`);
    if (typeRadio) {
      typeRadio.checked = true;
    }

    // 聚焦到末尾
    quickNoteContent.focus();
    quickNoteContent.setSelectionRange(draft.content.length, draft.content.length);

    draftRestoreBanner.style.display = 'none';
    showStatus(quickNoteStatus, 'success', t('draft_restored'));
  }
});

// 忽略草稿
ignoreDraftBtn.addEventListener('click', async () => {
  await clearDraft();
  draftRestoreBanner.style.display = 'none';
  showStatus(quickNoteStatus, 'info', t('draft_ignored'));
});

// 保存命名草稿
saveDraftBtn.addEventListener('click', async () => {
  const content = quickNoteContent.value.trim();
  if (!content) {
    showStatus(quickNoteStatus, 'error', t('draft_error_empty'));
    return;
  }

  const name = prompt(t('draft_prompt_name'));
  if (!name || name.trim() === '') {
    return;
  }

  const typeElement = document.querySelector('input[name="quick-note-type"]:checked');
  const type = typeElement ? parseInt(typeElement.value) : 0;

  const result = await saveNamedDraft(name, content, type);
  if (result.success) {
    showStatus(quickNoteStatus, 'success', result.message);
  } else {
    showStatus(quickNoteStatus, 'error', result.message);
  }
});

// 打开草稿管理
manageDraftsBtn.addEventListener('click', async () => {
  await refreshDraftsList();
  draftManagerModal.style.display = 'flex';
});

// 关闭草稿管理
closeDraftManagerBtn.addEventListener('click', () => {
  draftManagerModal.style.display = 'none';
});
closeDraftManagerFooterBtn.addEventListener('click', () => {
  draftManagerModal.style.display = 'none';
});

// 刷新草稿列表
async function refreshDraftsList() {
  const drafts = await listDrafts();
  
  if (drafts.length === 0) {
    draftsList.style.display = 'none';
    emptyDraftsMessage.style.display = 'block';
    return;
  }

  draftsList.style.display = 'block';
  emptyDraftsMessage.style.display = 'none';

  draftsList.innerHTML = drafts.map(draft => `
    <div class="draft-item" data-draft-id="${draft.id}">
      <div class="draft-item-header">
        <h4 class="draft-item-name">${escapeHtml(draft.name)}</h4>
        <span class="draft-item-time">${formatTimestamp(draft.updatedAt)}</span>
      </div>
      <div class="draft-item-preview">${escapeHtml(draft.content.substring(0, 100))}${draft.content.length > 100 ? '...' : ''}</div>
      <div class="draft-item-actions">
        <button class="btn btn-sm btn-primary load-draft-btn" data-draft-id="${draft.id}">${t('draft_btn_load')}</button>
        <button class="btn btn-sm btn-danger delete-draft-btn" data-draft-id="${draft.id}">${t('draft_btn_delete')}</button>
      </div>
    </div>
  `).join('');

  // 绑定加载草稿事件
  document.querySelectorAll('.load-draft-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.draftId;
      const drafts = await listDrafts();
      const draft = drafts.find(d => d.id === id);
      if (draft) {
        quickNoteContent.value = draft.content;
        const typeRadio = document.querySelector(`input[name="quick-note-type"][value="${draft.type}"]`);
        if (typeRadio) {
          typeRadio.checked = true;
        }
        draftManagerModal.style.display = 'none';
        quickNoteContent.focus();
        showStatus(quickNoteStatus, 'success', t('draft_loaded'));
      }
    });
  });

  // 绑定删除草稿事件
  document.querySelectorAll('.delete-draft-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.draftId;
      if (confirm(t('draft_confirm_delete'))) {
        const result = await deleteDraft(id);
        if (result.success) {
          await refreshDraftsList();
          showStatus(quickNoteStatus, 'success', result.message);
        } else {
          showStatus(quickNoteStatus, 'error', result.message);
        }
      }
    });
  });
}

// 格式化时间戳
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) { // 1分钟内
    return t('draft_just_now');
  } else if (diff < 3600000) { // 1小时内
    return t('draft_minutes_ago', Math.floor(diff / 60000).toString());
  } else if (diff < 86400000) { // 1天内
    return t('draft_hours_ago', Math.floor(diff / 3600000).toString());
  } else {
    return date.toLocaleDateString();
  }
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 快捷键支持 (Ctrl+Enter 提交)
quickNoteContent.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    submitQuickNoteBtn.click();
  }
});

clearQuickNoteBtn.addEventListener('click', async () => {
  quickNoteContent.value = '';
  await clearDraft(); // 清空当前草稿
  showStatus(quickNoteStatus, 'info', t('status_success_cleared'));
});

submitQuickNoteBtn.addEventListener('click', async () => {
  try {
    let content = quickNoteContent.value.trim();
    if (!content) {
      showStatus(quickNoteStatus, 'error', t('status_error_emptyContent'));
      return;
    }
    
    // 是否附加网页链接
    const includeLink = await getConfig('include_link_quick_note', true);
    if (includeLink) {
      const pageInfo = await getCurrentPageInfo();
      if (pageInfo && pageInfo.url && !pageInfo.url.startsWith('chrome://')) {
        content += `\n\n来源：[${pageInfo.title}](${pageInfo.url})`;
      }
    }
    
    showLoading(t('status_loading_saving'));
    
    const blinkoConfig = await getBlinkoConfig();
    const typeElement = document.querySelector('input[name="quick-note-type"]:checked');
    const type = typeElement ? parseInt(typeElement.value) : 0;
    
    const result = await createNote(
      blinkoConfig.apiUrl,
      blinkoConfig.authorization,
      content,
      type
    );
    
    if (result.success) {
      quickNoteContent.value = '';
      await clearDraft(); // 提交成功后清除草稿
      hideLoading();
      showStatus(quickNoteStatus, 'success', t('status_success_quickNoteSaved'));
    } else {
      hideLoading();
      showStatus(quickNoteStatus, 'error', result.message);
    }
    
  } catch (error) {
    hideLoading();
    showStatus(quickNoteStatus, 'error', t('status_error_saveFailed', error.message));
  }
});

// ========== 辅助函数 ==========
async function getBlinkoConfig() {
  return {
    apiUrl: await getConfig('blinko_api_url', ''),
    authorization: await getConfig('blinko_authorization', '')
  };
}

async function getOpenAIConfig() {
  return {
    baseUrl: await getConfig('openai_base_url', 'https://api.openai.com/v1'),
    apiKey: await getConfig('openai_key', ''),
    model: await getConfig('openai_model', 'gpt-3.5-turbo')
  };
}

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

async function getLazyLoadConfig() {
  return {
    enabled: await getConfig('enable_lazy_load_trigger', true),
    speed: await getConfig('lazy_load_scroll_speed', 'medium'),
    maxWait: await getConfig('lazy_load_max_wait', 10)
  };
}

function showLoading(text) {
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  loadingText.textContent = text;
  overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.display = 'none';
}

function showStatus(element, type, message) {
  element.className = `status-message ${type}`;
  element.textContent = message;
  element.style.display = 'block';
  
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      element.style.display = 'none';
    }, 3000);
  }
}

// 初始化
getCurrentPageInfo();
initDraftFeature(); // 初始化草稿功能



