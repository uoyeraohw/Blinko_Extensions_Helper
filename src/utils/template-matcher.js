/**
 * 模板匹配引擎
 * 根据域名规则匹配合适的模板
 */

import { t } from './i18n.js';

/**
 * 根据URL匹配模板
 * @param {string} url - 当前网页URL
 * @param {Array} templates - 模板列表 [{name, content}, ...]
 * @param {Array} domainRules - 域名规则列表 [{pattern, templateName, type}, ...]
 * @param {string} defaultTemplate - 默认模板名称
 * @returns {Object} {name: string, content: string}
 */
export function matchTemplate(url, templates, domainRules, defaultTemplate) {
  if (!url || !templates || templates.length === 0) {
    return getDefaultBuiltInTemplate();
  }
  
  // 遍历域名规则，找到第一个匹配的
  if (domainRules && domainRules.length > 0) {
    for (const rule of domainRules) {
      if (matchesRule(url, rule)) {
        // 找到匹配的模板
        const template = templates.find(t => t.name === rule.templateName);
        if (template) {
          return template;
        }
      }
    }
  }
  
  // 如果没有规则匹配，使用默认模板
  if (defaultTemplate) {
    const template = templates.find(t => t.name === defaultTemplate);
    if (template) {
      return template;
    }
  }
  
  // 如果默认模板不存在，使用第一个模板
  if (templates.length > 0) {
    return templates[0];
  }
  
  // 如果没有任何模板，返回内置默认模板
  return getDefaultBuiltInTemplate();
}

/**
 * 检查URL是否匹配规则
 * @param {string} url - URL字符串
 * @param {Object} rule - 规则对象 {pattern, type}
 * @returns {boolean}
 */
function matchesRule(url, rule) {
  const { pattern, type } = rule;
  
  if (!pattern) return false;
  
  try {
    switch (type) {
      case 'regex':
        // 正则表达式匹配
        const regex = new RegExp(pattern);
        return regex.test(url);
        
      case 'domain':
        // 主域名匹配
        return matchesDomain(url, pattern);
        
      case 'exact':
        // 完整URL匹配
        return url === pattern;
        
      default:
        // 默认使用主域名匹配
        return matchesDomain(url, pattern);
    }
  } catch (error) {
    console.error('规则匹配失败', pattern, error);
    return false;
  }
}

/**
 * 主域名匹配
 * @param {string} url - URL字符串
 * @param {string} domainPattern - 域名模式
 * @returns {boolean}
 */
function matchesDomain(url, domainPattern) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // 移除pattern中的协议和端口
    const cleanPattern = domainPattern
      .replace(/^https?:\/\//, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
    
    // 检查是否匹配
    const lowerHostname = hostname.toLowerCase();
    
    // 完全匹配
    if (lowerHostname === cleanPattern) {
      return true;
    }
    
    // 子域名匹配 (例如: pattern='example.com' 匹配 'www.example.com')
    if (lowerHostname.endsWith('.' + cleanPattern)) {
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('域名匹配失败', error);
    return false;
  }
}

/**
 * 应用模板到内容
 * @param {string} template - 模板字符串（system prompt）
 * @param {string} content - 网页内容（user prompt）
 * @returns {Object} {systemPrompt: string, userPrompt: string}
 */
export function replaceVariables(template, content) {
  // 模板始终作为system prompt，网页内容作为user prompt
  return {
    systemPrompt: template || '',
    userPrompt: content
  };
}

/**
 * 获取内置默认模板
 * @returns {Object} {name: string, content: string}
 */
function getDefaultBuiltInTemplate() {
  return {
    name: '内置默认模板',
    content: '我是一个专业的内容分析师，擅长快速理解和提炼网页的核心信息。我会关注文章的主要观点、关键数据和重要结论，并以简洁清晰的方式进行总结。'
  };
}

/**
 * 验证模板内容
 * @param {string} content - 模板内容
 * @returns {Object} {valid: boolean, message: string}
 */
export function validateTemplate(content) {
  if (!content || content.trim() === '') {
    return { valid: false, message: t('validation_templateEmpty') };
  }
  
  if (content.length > 5000) {
    return { valid: false, message: t('validation_templateTooLong') };
  }
  
  return { valid: true, message: t('validation_templateValid') };
}

/**
 * 验证域名规则
 * @param {string} pattern - 规则模式
 * @param {string} type - 规则类型
 * @returns {Object} {valid: boolean, message: string}
 */
export function validateDomainRule(pattern, type) {
  if (!pattern || pattern.trim() === '') {
    return { valid: false, message: t('validation_patternEmpty') };
  }
  
  if (type === 'regex') {
    try {
      new RegExp(pattern);
      return { valid: true, message: t('validation_regexValid') };
    } catch (error) {
      return { valid: false, message: t('validation_regexInvalid') };
    }
  }
  
  if (type === 'exact') {
    try {
      new URL(pattern);
      return { valid: true, message: t('validation_urlValid') };
    } catch (error) {
      return { valid: false, message: t('validation_urlInvalid') };
    }
  }
  
  // domain类型不需要特殊验证
  return { valid: true, message: t('validation_domainRuleValid') };
}

/**
 * 从URL提取域名
 * @param {string} url - URL字符串
 * @returns {string} 域名
 */
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return '';
  }
}

/**
 * 获取域名的主域名部分
 * @param {string} hostname - 主机名
 * @returns {string} 主域名
 */
export function getMainDomain(hostname) {
  if (!hostname) return '';
  
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    // 返回最后两部分 (例如: www.example.com -> example.com)
    return parts.slice(-2).join('.');
  }
  
  return hostname;
}

/**
 * 根据URL匹配域名标签
 * @param {string} url - 当前网页URL
 * @param {Array} domainTagRules - 域名标签规则列表 [{pattern, type, tags}, ...]
 * @param {string} strategy - 匹配策略: 'first' | 'merge'
 * @returns {string} 匹配到的标签字符串（可能为空）
 */
export function matchDomainTags(url, domainTagRules, strategy = 'first') {
  if (!url || !domainTagRules || domainTagRules.length === 0) {
    return '';
  }
  
  const matchedTags = [];
  
  for (const rule of domainTagRules) {
    if (matchesRule(url, rule)) {
      if (strategy === 'first') {
        // 第一个匹配策略：返回第一个匹配的规则的标签
        return rule.tags || '';
      } else if (strategy === 'merge') {
        // 合并策略：收集所有匹配规则的标签
        if (rule.tags) {
          matchedTags.push(rule.tags);
        }
      }
    }
  }
  
  // 合并策略下，合并所有标签并去重
  if (strategy === 'merge' && matchedTags.length > 0) {
    const allTags = matchedTags.join(' ').split(/\s+/);
    const uniqueTags = [...new Set(allTags)];
    return uniqueTags.join(' ');
  }
  
  return '';
}



