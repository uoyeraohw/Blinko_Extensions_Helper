/**
 * 设置页面逻辑
 */

import { saveConfig, getConfig, getAllConfig, exportConfig, importConfig } from './utils/storage.js';
import { validateBlinkoConnection, validateOpenAI, optimizeTemplate } from './utils/api-client.js';
import { validateS3Config } from './utils/s3-uploader.js';
import { validateTemplate, validateDomainRule } from './utils/template-matcher.js';
import { t, initI18nSystem, initI18n, setUserLocale, getUserLocale, reloadPage } from './utils/i18n.js';

// 异步初始化国际化
(async () => {
  await initI18nSystem();
  initI18n();
})();

// Tab切换
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const targetTab = button.dataset.tab;
    switchTab(targetTab);
  });
});

function switchTab(tabName) {
  // 更新按钮状态
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // 更新内容显示
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
}

// ========== Tab 1: Blinko配置 ==========
const blinkoApiUrl = document.getElementById('blinko-api-url');
const blinkoAuth = document.getElementById('blinko-auth');
const validateBlinkoBtn = document.getElementById('validate-blinko');
const blinkoStatus = document.getElementById('blinko-status');

// 加载配置
async function loadBlinkoConfig() {
  blinkoApiUrl.value = await getConfig('blinko_api_url', '');
  blinkoAuth.value = await getConfig('blinko_authorization', '');
}

// 自动保存
blinkoApiUrl.addEventListener('change', () => saveConfig('blinko_api_url', blinkoApiUrl.value));
blinkoAuth.addEventListener('change', () => saveConfig('blinko_authorization', blinkoAuth.value));

// 验证连接
validateBlinkoBtn.addEventListener('click', async () => {
  showStatus(blinkoStatus, 'info', t('status_loading_validating'));
  
  const result = await validateBlinkoConnection(blinkoApiUrl.value, blinkoAuth.value);
  
  if (result.success) {
    showStatus(blinkoStatus, 'success', result.message);
  } else {
    showStatus(blinkoStatus, 'error', result.message);
  }
});

// ========== Tab 2: OpenAI配置 ==========
const openaiBaseUrl = document.getElementById('openai-base-url');
const openaiKey = document.getElementById('openai-key');
const openaiModel = document.getElementById('openai-model');
const validateOpenAIBtn = document.getElementById('validate-openai');
const openaiStatus = document.getElementById('openai-status');

async function loadOpenAIConfig() {
  openaiBaseUrl.value = await getConfig('openai_base_url', '');
  openaiKey.value = await getConfig('openai_key', '');
  openaiModel.value = await getConfig('openai_model', '');
}

openaiBaseUrl.addEventListener('change', () => saveConfig('openai_base_url', openaiBaseUrl.value));
openaiKey.addEventListener('change', () => saveConfig('openai_key', openaiKey.value));
openaiModel.addEventListener('change', () => saveConfig('openai_model', openaiModel.value));

validateOpenAIBtn.addEventListener('click', async () => {
  showStatus(openaiStatus, 'info', t('status_loading_validating'));
  
  const result = await validateOpenAI(
    openaiBaseUrl.value || 'https://api.openai.com/v1',
    openaiKey.value,
    openaiModel.value || 'gpt-3.5-turbo'
  );
  
  if (result.success) {
    showStatus(openaiStatus, 'success', result.message);
  } else {
    showStatus(openaiStatus, 'error', result.message);
  }
});

// ========== Tab 3: 模板管理 ==========
const templateSelector = document.getElementById('template-selector');
const templateContent = document.getElementById('template-content');
const defaultTemplateSelect = document.getElementById('default-template');
const newTemplateName = document.getElementById('new-template-name');
const addTemplateBtn = document.getElementById('add-template');
const optimizeTemplateBtn = document.getElementById('optimize-template');
const saveTemplateBtn = document.getElementById('save-template');
const deleteTemplateBtn = document.getElementById('delete-template');
const templateStatus = document.getElementById('template-status');

// 域名规则
const domainPattern = document.getElementById('domain-pattern');
const domainRuleType = document.getElementById('domain-rule-type');
const domainTemplate = document.getElementById('domain-template');
const addDomainRuleBtn = document.getElementById('add-domain-rule');
const domainRulesList = document.getElementById('domain-rules-list');

let templates = [];
let domainRules = [];

async function loadTemplates() {
  templates = await getConfig('templates', [{
    name: t('settings_templates_defaultName'),
    content: t('settings_templates_defaultContent')
  }]);
  
  domainRules = await getConfig('domain_rules', []);
  const defaultTemplate = await getConfig('default_template', t('settings_templates_defaultName'));
  
  updateTemplateSelectors();
  defaultTemplateSelect.value = defaultTemplate;
  displayDomainRules();
}

function updateTemplateSelectors() {
  // 更新所有模板选择器
  const selectors = [templateSelector, defaultTemplateSelect, domainTemplate];
  
  selectors.forEach(select => {
    const currentValue = select.value;
    select.innerHTML = `<option value="">${t('common_selectPlaceholder')}</option>`;
    
    templates.forEach(template => {
      const option = document.createElement('option');
      option.value = template.name;
      option.textContent = template.name;
      select.appendChild(option);
    });
    
    if (currentValue) {
      select.value = currentValue;
    }
  });
}

templateSelector.addEventListener('change', () => {
  const selectedTemplate = templates.find(t => t.name === templateSelector.value);
  if (selectedTemplate) {
    templateContent.value = selectedTemplate.content;
  } else {
    templateContent.value = '';
  }
});

addTemplateBtn.addEventListener('click', async () => {
  const name = newTemplateName.value.trim();
  
  if (!name) {
    showStatus(templateStatus, 'error', t('settings_templates_error_nameEmpty'));
    return;
  }
  
  if (templates.find(t => t.name === name)) {
    showStatus(templateStatus, 'error', t('settings_templates_error_nameExists'));
    return;
  }
  
  templates.push({ name, content: '' });
  await saveConfig('templates', templates);
  
  updateTemplateSelectors();
  templateSelector.value = name;
  templateContent.value = '';
  newTemplateName.value = '';
  
  showStatus(templateStatus, 'success', t('settings_templates_success_created', name));
});

saveTemplateBtn.addEventListener('click', async () => {
  const selectedName = templateSelector.value;
  
  if (!selectedName) {
    showStatus(templateStatus, 'error', t('settings_templates_error_noSelection'));
    return;
  }
  
  const validation = validateTemplate(templateContent.value);
  if (!validation.valid) {
    showStatus(templateStatus, 'error', validation.message);
    return;
  }
  
  const template = templates.find(t => t.name === selectedName);
  if (template) {
    template.content = templateContent.value;
    await saveConfig('templates', templates);
    showStatus(templateStatus, 'success', t('status_success_templateSaved'));
  }
});

deleteTemplateBtn.addEventListener('click', async () => {
  const selectedName = templateSelector.value;
  
  if (!selectedName) {
    showStatus(templateStatus, 'error', t('settings_templates_error_noSelectionDelete'));
    return;
  }
  
  if (!confirm(t('settings_templates_confirmDelete', selectedName))) {
    return;
  }
  
  templates = templates.filter(t => t.name !== selectedName);
  await saveConfig('templates', templates);
  
  // 如果删除的是默认模板，清除默认设置
  if (defaultTemplateSelect.value === selectedName) {
    defaultTemplateSelect.value = '';
    await saveConfig('default_template', '');
  }
  
  updateTemplateSelectors();
  templateSelector.value = '';
  templateContent.value = '';
  
  showStatus(templateStatus, 'success', t('settings_templates_success_deleted', selectedName));
});

// AI优化模板
optimizeTemplateBtn.addEventListener('click', async () => {
  // 验证模板内容非空
  const content = templateContent.value;
  if (!content || content.trim() === '') {
    showStatus(templateStatus, 'error', t('settings_templates_error_contentEmpty'));
    return;
  }
  
  // 获取OpenAI配置
  const openaiBaseUrl = await getConfig('openai_base_url', '');
  const openaiKey = await getConfig('openai_key', '');
  const openaiModel = await getConfig('openai_model', '');
  
  // 验证OpenAI配置完整性
  if (!openaiKey) {
    showStatus(templateStatus, 'error', t('settings_templates_error_noOpenAI'));
    return;
  }
  
  // 保存原始内容（用于可能的撤销）
  const originalContent = content;
  
  // 显示加载状态
  showStatus(templateStatus, 'info', t('settings_templates_loading_optimizing'));
  const originalBtnText = optimizeTemplateBtn.textContent;
  optimizeTemplateBtn.textContent = t('settings_templates_btn_optimizing');
  optimizeTemplateBtn.disabled = true;
  saveTemplateBtn.disabled = true;
  deleteTemplateBtn.disabled = true;
  
  try {
    // 调用API优化模板
    const result = await optimizeTemplate(
      openaiBaseUrl || 'https://api.openai.com/v1',
      openaiKey,
      openaiModel || 'gpt-3.5-turbo',
      content
    );
    
    if (result.success) {
      // 成功：替换模板内容
      templateContent.value = result.optimizedTemplate;
      templateContent.scrollTop = 0;
      templateContent.focus();
      showStatus(templateStatus, 'success', t('settings_templates_success_optimized'));
    } else {
      // 失败：显示错误信息
      showStatus(templateStatus, 'error', result.message);
    }
  } catch (error) {
    console.error('优化模板时发生错误', error);
    showStatus(templateStatus, 'error', t('settings_templates_error_optimizeFailed', error.message));
  } finally {
    // 恢复按钮状态
    optimizeTemplateBtn.textContent = originalBtnText;
    optimizeTemplateBtn.disabled = false;
    saveTemplateBtn.disabled = false;
    deleteTemplateBtn.disabled = false;
  }
});

defaultTemplateSelect.addEventListener('change', async () => {
  await saveConfig('default_template', defaultTemplateSelect.value);
  showStatus(templateStatus, 'success', t('settings_templates_success_defaultUpdated'));
});

// 域名规则管理
addDomainRuleBtn.addEventListener('click', async () => {
  const pattern = domainPattern.value.trim();
  const type = domainRuleType.value;
  const templateName = domainTemplate.value;
  
  if (!pattern) {
    showStatus(templateStatus, 'error', t('settings_templates_error_patternEmpty'));
    return;
  }
  
  if (!templateName) {
    showStatus(templateStatus, 'error', t('settings_templates_error_noTemplateSelected'));
    return;
  }
  
  const validation = validateDomainRule(pattern, type);
  if (!validation.valid) {
    showStatus(templateStatus, 'error', validation.message);
    return;
  }
  
  domainRules.push({ pattern, type, templateName });
  await saveConfig('domain_rules', domainRules);
  
  domainPattern.value = '';
  domainTemplate.value = '';
  displayDomainRules();
  
  showStatus(templateStatus, 'success', t('settings_templates_success_ruleAdded'));
});

function displayDomainRules() {
  if (domainRules.length === 0) {
    domainRulesList.innerHTML = `<div class="empty-list">${t('settings_templates_emptyList')}</div>`;
    return;
  }
  
  domainRulesList.innerHTML = '';
  
  domainRules.forEach((rule, index) => {
    const ruleItem = document.createElement('div');
    ruleItem.className = 'rule-item';
    
    const typeText = {
      'domain': t('settings_templates_ruleType_domain'),
      'regex': t('settings_templates_ruleType_regex'),
      'exact': t('settings_templates_ruleType_exact')
    }[rule.type] || rule.type;
    
    ruleItem.innerHTML = `
      <div class="rule-info">
        <strong>${rule.pattern}</strong>
        <span>${typeText} → ${rule.templateName}</span>
      </div>
      <div class="rule-actions">
        <button data-index="${index}">删除</button>
      </div>
    `;
    
    ruleItem.querySelector('button').addEventListener('click', () => deleteRule(index));
    domainRulesList.appendChild(ruleItem);
  });
}

async function deleteRule(index) {
  domainRules.splice(index, 1);
  await saveConfig('domain_rules', domainRules);
  displayDomainRules();
  showStatus(templateStatus, 'success', t('settings_templates_success_ruleDeleted'));
}

// ========== Tab 4: 标签配置 ==========
const tagSummary = document.getElementById('tag-summary');
const tagSelection = document.getElementById('tag-selection');
const tagImage = document.getElementById('tag-image');
const tagClipping = document.getElementById('tag-clipping');

async function loadTagConfig() {
  tagSummary.value = await getConfig('tag_summary', '#网页/总结');
  tagSelection.value = await getConfig('tag_selection', '#网页/划词');
  tagImage.value = await getConfig('tag_image', '#网页/图片');
  tagClipping.value = await getConfig('tag_clipping', '#网页/剪藏');
}

tagSummary.addEventListener('change', () => saveConfig('tag_summary', tagSummary.value));
tagSelection.addEventListener('change', () => saveConfig('tag_selection', tagSelection.value));
tagImage.addEventListener('change', () => saveConfig('tag_image', tagImage.value));
tagClipping.addEventListener('change', () => saveConfig('tag_clipping', tagClipping.value));

// 域名标签配置
const domainTagPattern = document.getElementById('domain-tag-pattern');
const domainTagType = document.getElementById('domain-tag-type');
const domainTagTags = document.getElementById('domain-tag-tags');
const addDomainTagRuleBtn = document.getElementById('add-domain-tag-rule');
const domainTagRulesList = document.getElementById('domain-tag-rules-list');
const domainTagMatchStrategy = document.getElementById('domain-tag-match-strategy');

let domainTagRules = [];

async function loadDomainTagConfig() {
  domainTagRules = await getConfig('domain_tag_rules', []);
  const strategy = await getConfig('domain_tag_match_strategy', 'first');
  domainTagMatchStrategy.value = strategy;
  displayDomainTagRules();
}

addDomainTagRuleBtn.addEventListener('click', async () => {
  const pattern = domainTagPattern.value.trim();
  const type = domainTagType.value;
  const tags = domainTagTags.value.trim();
  
  if (!pattern) {
    showStatus(document.getElementById('tag-status'), 'error', t('settings_tags_error_patternEmpty'));
    return;
  }
  
  if (!tags) {
    showStatus(document.getElementById('tag-status'), 'error', t('settings_tags_error_tagsEmpty'));
    return;
  }
  
  const validation = validateDomainRule(pattern, type);
  if (!validation.valid) {
    showStatus(document.getElementById('tag-status'), 'error', validation.message);
    return;
  }
  
  domainTagRules.push({ pattern, type, tags });
  await saveConfig('domain_tag_rules', domainTagRules);
  
  domainTagPattern.value = '';
  domainTagTags.value = '';
  displayDomainTagRules();
  
  showStatus(document.getElementById('tag-status'), 'success', t('settings_tags_success_ruleAdded'));
});

function displayDomainTagRules() {
  if (domainTagRules.length === 0) {
    domainTagRulesList.innerHTML = `<div style="color: #999; padding: 10px; text-align: center;">${t('settings_tags_emptyList')}</div>`;
    return;
  }
  
  domainTagRulesList.innerHTML = '';
  
  domainTagRules.forEach((rule, index) => {
    const ruleItem = document.createElement('div');
    ruleItem.className = 'rule-item';
    ruleItem.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f9f9f9; border-radius: 4px; margin-bottom: 8px;';
    
    const typeText = {
      'domain': t('settings_templates_ruleType_domain'),
      'regex': t('settings_templates_ruleType_regex'),
      'exact': t('settings_templates_ruleType_exact')
    }[rule.type] || rule.type;
    
    ruleItem.innerHTML = `
      <div style="flex: 1;">
        <strong style="color: #333;">${rule.pattern}</strong>
        <span style="color: #666; margin-left: 10px;">${typeText} → ${rule.tags}</span>
      </div>
      <button data-index="${index}" style="padding: 5px 15px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">删除</button>
    `;
    
    ruleItem.querySelector('button').addEventListener('click', () => deleteDomainTagRule(index));
    domainTagRulesList.appendChild(ruleItem);
  });
}

async function deleteDomainTagRule(index) {
  domainTagRules.splice(index, 1);
  await saveConfig('domain_tag_rules', domainTagRules);
  displayDomainTagRules();
  showStatus(document.getElementById('tag-status'), 'success', t('settings_tags_success_ruleDeleted'));
}

domainTagMatchStrategy.addEventListener('change', async () => {
  await saveConfig('domain_tag_match_strategy', domainTagMatchStrategy.value);
  showStatus(document.getElementById('tag-status'), 'success', t('settings_tags_success_strategyUpdated'));
});

// ========== Tab 5: 存储配置 ==========
const keepOriginalLink = document.getElementById('keep-original-link');
const s3ConfigSection = document.getElementById('s3-config');
const s3AccessKey = document.getElementById('s3-access-key');
const s3SecretKey = document.getElementById('s3-secret-key');
const s3Endpoint = document.getElementById('s3-endpoint');
const s3Region = document.getElementById('s3-region');
const s3Bucket = document.getElementById('s3-bucket');
const s3Cdn = document.getElementById('s3-cdn');
const s3CustomPath = document.getElementById('s3-custom-path');
const s3Acl = document.getElementById('s3-acl');
const s3PresignedExpiry = document.getElementById('s3-presigned-expiry');
const s3PresignedExpiryGroup = document.getElementById('s3-presigned-expiry-group');
const validateS3Btn = document.getElementById('validate-s3');
const storageStatus = document.getElementById('storage-status');

async function loadStorageConfig() {
  const keepOriginal = await getConfig('keep_original_image_link', true);
  keepOriginalLink.value = keepOriginal.toString();
  toggleS3Config(keepOriginal);
  
  s3AccessKey.value = await getConfig('s3_access_key', '');
  s3SecretKey.value = await getConfig('s3_secret_key', '');
  s3Endpoint.value = await getConfig('s3_endpoint', '');
  s3Region.value = await getConfig('s3_region', '');
  s3Bucket.value = await getConfig('s3_bucket', '');
  s3Cdn.value = await getConfig('s3_cdn', '');
  s3CustomPath.value = await getConfig('s3_custom_path', '');
  
  const aclValue = await getConfig('s3_acl', 'public');
  const expiryValue = await getConfig('s3_presigned_expiry', 3650);
  s3Acl.value = aclValue;
  s3PresignedExpiry.value = expiryValue;
  togglePresignedExpiryGroup(aclValue);
}

keepOriginalLink.addEventListener('change', async () => {
  const value = keepOriginalLink.value === 'true';
  await saveConfig('keep_original_image_link', value);
  toggleS3Config(value);
});

function toggleS3Config(keepOriginal) {
  s3ConfigSection.style.display = keepOriginal ? 'none' : 'block';
}

function togglePresignedExpiryGroup(acl) {
  s3PresignedExpiryGroup.style.display = acl === 'private' ? 'block' : 'none';
}

s3AccessKey.addEventListener('change', () => saveConfig('s3_access_key', s3AccessKey.value));
s3SecretKey.addEventListener('change', () => saveConfig('s3_secret_key', s3SecretKey.value));
s3Endpoint.addEventListener('change', () => saveConfig('s3_endpoint', s3Endpoint.value));
s3Region.addEventListener('change', () => saveConfig('s3_region', s3Region.value));
s3Bucket.addEventListener('change', () => saveConfig('s3_bucket', s3Bucket.value));
s3Cdn.addEventListener('change', () => saveConfig('s3_cdn', s3Cdn.value));
s3CustomPath.addEventListener('change', () => saveConfig('s3_custom_path', s3CustomPath.value));

s3Acl.addEventListener('change', async () => {
  await saveConfig('s3_acl', s3Acl.value);
  togglePresignedExpiryGroup(s3Acl.value);
});

s3PresignedExpiry.addEventListener('change', () => 
  saveConfig('s3_presigned_expiry', parseInt(s3PresignedExpiry.value))
);

validateS3Btn.addEventListener('click', async () => {
  showStatus(storageStatus, 'info', t('settings_storage_loading_validating'));
  
  const config = {
    accessKey: s3AccessKey.value,
    secretKey: s3SecretKey.value,
    endpoint: s3Endpoint.value,
    region: s3Region.value,
    bucket: s3Bucket.value
  };
  
  const result = await validateS3Config(config);
  
  if (result.success) {
    showStatus(storageStatus, 'success', result.message);
  } else {
    showStatus(storageStatus, 'error', result.message);
  }
});

// ========== Tab 6: 通用设置 ==========
const linkSummary = document.getElementById('link-summary');
const linkSelection = document.getElementById('link-selection');
const linkImage = document.getElementById('link-image');
const linkQuickNote = document.getElementById('link-quick-note');
const enableLazyLoadTrigger = document.getElementById('enable-lazy-load-trigger');
const lazyLoadScrollSpeed = document.getElementById('lazy-load-scroll-speed');
const lazyLoadMaxWait = document.getElementById('lazy-load-max-wait');
const exportConfigBtn = document.getElementById('export-config');
const importFileInput = document.getElementById('import-file');
const generalStatus = document.getElementById('general-status');

async function loadGeneralSettings() {
  linkSummary.checked = await getConfig('include_link_summary', true);
  linkSelection.checked = await getConfig('include_link_selection', true);
  linkImage.checked = await getConfig('include_link_image', true);
  linkQuickNote.checked = await getConfig('include_link_quick_note', true);
  
  // 懒加载触发配置
  enableLazyLoadTrigger.checked = await getConfig('enable_lazy_load_trigger', true);
  lazyLoadScrollSpeed.value = await getConfig('lazy_load_scroll_speed', 'medium');
  lazyLoadMaxWait.value = await getConfig('lazy_load_max_wait', 10);
}

linkSummary.addEventListener('change', () => saveConfig('include_link_summary', linkSummary.checked));
linkSelection.addEventListener('change', () => saveConfig('include_link_selection', linkSelection.checked));
linkImage.addEventListener('change', () => saveConfig('include_link_image', linkImage.checked));
linkQuickNote.addEventListener('change', () => saveConfig('include_link_quick_note', linkQuickNote.checked));

// 懒加载触发配置监听器
enableLazyLoadTrigger.addEventListener('change', () => 
  saveConfig('enable_lazy_load_trigger', enableLazyLoadTrigger.checked)
);
lazyLoadScrollSpeed.addEventListener('change', () => 
  saveConfig('lazy_load_scroll_speed', lazyLoadScrollSpeed.value)
);
lazyLoadMaxWait.addEventListener('change', () => 
  saveConfig('lazy_load_max_wait', parseInt(lazyLoadMaxWait.value))
);

exportConfigBtn.addEventListener('click', async () => {
  try {
    const json = await exportConfig();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blinko-plugin-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showStatus(generalStatus, 'success', t('settings_general_success_exported'));
  } catch (error) {
    showStatus(generalStatus, 'error', t('settings_general_error_exportFailed', error.message));
  }
});

importFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!confirm(t('settings_general_confirmImport'))) {
    importFileInput.value = '';
    return;
  }
  
  try {
    const text = await file.text();
    await importConfig(text);
    
    // 重新加载所有配置
    await loadAllConfigs();
    
    showStatus(generalStatus, 'success', t('settings_general_success_imported'));
    setTimeout(() => location.reload(), 1500);
  } catch (error) {
    showStatus(generalStatus, 'error', error.message);
  }
  
  importFileInput.value = '';
});

// ========== 辅助函数 ==========
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

// ========== 语言选择功能 ==========
const languageSelector = document.getElementById('interface-language');
const refreshPageBtn = document.getElementById('refresh-page');

// 加载语言偏好
async function loadLanguagePreference() {
  try {
    const userLang = await getUserLocale();
    if (languageSelector) {
      languageSelector.value = userLang || 'auto';
    }
  } catch (error) {
    console.error('Failed to load language preference', error);
  }
}

// 语言切换事件
if (languageSelector) {
  languageSelector.addEventListener('change', async () => {
    try {
      const selectedLang = languageSelector.value;
      await setUserLocale(selectedLang);
      
      // 显示刷新按钮
      if (refreshPageBtn) {
        refreshPageBtn.style.display = 'inline-block';
      }
      
      showStatus(generalStatus, 'success', t('status_success_settingsSaved'));
    } catch (error) {
      console.error('Failed to save language preference', error);
      showStatus(generalStatus, 'error', t('status_error_saveFailed', error.message));
    }
  });
}

// 刷新页面按钮
if (refreshPageBtn) {
  refreshPageBtn.addEventListener('click', () => {
    reloadPage();
  });
}

// ========== 页面加载时初始化 ==========
async function loadAllConfigs() {
  await loadBlinkoConfig();
  await loadOpenAIConfig();
  await loadTemplates();
  await loadTagConfig();
  await loadDomainTagConfig();
  await loadStorageConfig();
  await loadGeneralSettings();
  await loadLanguagePreference();
}

// 初始化
loadAllConfigs();



