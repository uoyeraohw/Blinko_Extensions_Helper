/**
 * 国际化（i18n）工具模块
 * 支持动态语言切换的自定义实现
 */

// 全局消息缓存
let messagesCache = {};
let currentLanguage = 'zh_CN';

/**
 * 初始化 i18n 系统
 * 必须在使用任何翻译功能前调用
 */
export async function initI18nSystem() {
  try {
    // 1. 获取用户语言偏好
    const userLang = await getUserLocale();
    
    // 2. 确定要使用的语言
    if (userLang && userLang !== 'auto') {
      currentLanguage = userLang;
    } else {
      // 自动检测浏览器语言
      const browserLang = chrome.i18n.getUILanguage();
      if (browserLang.startsWith('en')) {
        currentLanguage = 'en';
      } else {
        currentLanguage = 'zh_CN';
      }
    }
    
    // 3. 加载对应的语言包
    await loadMessages(currentLanguage);
    
    console.log(`[i18n] Initialized with language: ${currentLanguage}`);
  } catch (error) {
    console.error('[i18n] Initialization failed, falling back to zh_CN', error);
    currentLanguage = 'zh_CN';
    await loadMessages('zh_CN');
  }
}

/**
 * 加载语言包
 * @param {string} locale - 语言代码
 */
async function loadMessages(locale) {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const response = await fetch(url);
    const messages = await response.json();
    messagesCache = messages;
    console.log(`[i18n] Loaded ${Object.keys(messages).length} messages for ${locale}`);
  } catch (error) {
    console.error(`[i18n] Failed to load messages for ${locale}`, error);
    // 如果加载失败，尝试加载默认语言
    if (locale !== 'zh_CN') {
      const url = chrome.runtime.getURL(`_locales/zh_CN/messages.json`);
      const response = await fetch(url);
      messagesCache = await response.json();
    }
  }
}

/**
 * 获取翻译文本（基础函数）
 * @param {string} key - 消息键
 * @param {...string} placeholders - 占位符替换值
 * @returns {string} 翻译后的文本
 */
export function t(key, ...placeholders) {
  try {
    const messageObj = messagesCache[key];
    if (!messageObj || !messageObj.message) {
      console.warn(`[i18n] Message key not found: ${key}`);
      return key;
    }
    
    let message = messageObj.message;
    
    // 替换占位符 $1, $2, $3...
    if (placeholders && placeholders.length > 0) {
      placeholders.forEach((value, index) => {
        const placeholder = `$${index + 1}`;
        message = message.replace(new RegExp(`\\${placeholder}`, 'g'), value);
      });
      
      // 替换命名占位符 $NAME$, $ERROR$ 等
      if (messageObj.placeholders) {
        Object.keys(messageObj.placeholders).forEach((name, index) => {
          const upperName = name.toUpperCase();
          const value = placeholders[index] || '';
          message = message.replace(new RegExp(`\\$${upperName}\\$`, 'g'), value);
        });
      }
    }
    
    return message;
  } catch (error) {
    console.error(`[i18n] Error getting message for key: ${key}`, error);
    return key;
  }
}

/**
 * 获取翻译文本（支持命名变量）
 * @param {string} key - 消息键
 * @param {Object} vars - 变量对象
 * @returns {string} 翻译后的文本
 */
export function tWithVars(key, vars) {
  try {
    const messageObj = messagesCache[key];
    if (!messageObj || !messageObj.message) {
      console.warn(`[i18n] Message key not found: ${key}`);
      return key;
    }
    
    let message = messageObj.message;
    
    // 替换命名占位符 {varName}
    Object.keys(vars).forEach(varKey => {
      const regex = new RegExp(`\\{${varKey}\\}`, 'g');
      message = message.replace(regex, vars[varKey]);
    });
    
    return message;
  } catch (error) {
    console.error(`[i18n] Error getting message for key: ${key}`, error);
    return key;
  }
}

/**
 * 初始化HTML页面的i18n
 * 必须在 initI18nSystem() 之后调用
 * @param {Element|Document} container - 容器元素
 */
export function initI18n(container = document) {
  try {
    // 处理 textContent
    container.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = t(key);
      }
    });
    
    // 处理 placeholder
    container.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (key) {
        el.placeholder = t(key);
      }
    });
    
    // 处理 title
    container.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (key) {
        el.title = t(key);
      }
    });
    
    // 处理 aria-label
    container.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.dataset.i18nAria;
      if (key) {
        el.setAttribute('aria-label', t(key));
      }
    });
    
    console.log('[i18n] HTML initialization completed');
  } catch (error) {
    console.error('[i18n] HTML initialization failed', error);
  }
}

/**
 * 获取当前语言
 * @returns {string} 语言代码
 */
export function getCurrentLocale() {
  return currentLanguage;
}

/**
 * 获取支持的语言列表
 * @returns {Array<{code: string, name: string}>} 语言列表
 */
export function getSupportedLocales() {
  // 注意：这里的 name 需要硬编码，因为在选择器加载前可能还没初始化
  return [
    { code: 'auto', name: '自动（跟随浏览器）', nameEn: 'Auto (Follow Browser)' },
    { code: 'zh_CN', name: '中文（简体）', nameEn: '中文（简体）' },
    { code: 'en', name: 'English', nameEn: 'English' }
  ];
}

/**
 * 设置用户语言偏好
 * @param {string} locale - 语言代码
 * @returns {Promise<void>}
 */
export async function setUserLocale(locale) {
  try {
    await chrome.storage.local.set({ userLanguage: locale });
    console.log(`[i18n] User language set to: ${locale}`);
  } catch (error) {
    console.error('[i18n] Error setting user locale', error);
  }
}

/**
 * 获取用户语言偏好
 * @returns {Promise<string>} 语言代码
 */
export async function getUserLocale() {
  try {
    const result = await chrome.storage.local.get('userLanguage');
    return result.userLanguage || 'auto';
  } catch (error) {
    console.error('[i18n] Error getting user locale', error);
    return 'auto';
  }
}

/**
 * 重载当前页面（用于语言切换）
 */
export function reloadPage() {
  window.location.reload();
}

// 默认导出
export default {
  initI18nSystem,
  t,
  tWithVars,
  initI18n,
  getCurrentLocale,
  getSupportedLocales,
  setUserLocale,
  getUserLocale,
  reloadPage
};
