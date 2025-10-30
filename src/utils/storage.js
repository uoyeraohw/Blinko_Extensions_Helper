/**
 * Chrome Storage API 封装
 * 统一管理扩展的配置存储
 */

/**
 * 保存配置到Chrome Storage
 * @param {string} key - 配置键名
 * @param {any} value - 配置值
 * @returns {Promise<void>}
 */
export async function saveConfig(key, value) {
  try {
    await chrome.storage.sync.set({ [key]: value });
    console.log(`配置已保存: ${key}`);
  } catch (error) {
    console.error(`保存配置失败: ${key}`, error);
    throw new Error(`保存配置失败: ${error.message}`);
  }
}

/**
 * 读取配置from Chrome Storage
 * @param {string} key - 配置键名
 * @param {any} defaultValue - 默认值
 * @returns {Promise<any>}
 */
export async function getConfig(key, defaultValue = null) {
  try {
    const result = await chrome.storage.sync.get([key]);
    return result[key] !== undefined ? result[key] : defaultValue;
  } catch (error) {
    console.error(`读取配置失败: ${key}`, error);
    return defaultValue;
  }
}

/**
 * 删除配置
 * @param {string} key - 配置键名
 * @returns {Promise<void>}
 */
export async function deleteConfig(key) {
  try {
    await chrome.storage.sync.remove([key]);
    console.log(`配置已删除: ${key}`);
  } catch (error) {
    console.error(`删除配置失败: ${key}`, error);
    throw new Error(`删除配置失败: ${error.message}`);
  }
}

/**
 * 获取所有配置
 * @returns {Promise<Object>}
 */
export async function getAllConfig() {
  try {
    const result = await chrome.storage.sync.get(null);
    return result;
  } catch (error) {
    console.error('获取所有配置失败', error);
    return {};
  }
}

/**
 * 导出所有配置为JSON
 * @returns {Promise<string>} JSON字符串
 */
export async function exportConfig() {
  try {
    const config = await getAllConfig();
    
    // 脱敏处理敏感信息
    const sanitizedConfig = { ...config };
    if (sanitizedConfig.blinko_authorization) {
      sanitizedConfig.blinko_authorization = maskSensitiveInfo(sanitizedConfig.blinko_authorization);
    }
    if (sanitizedConfig.openai_key) {
      sanitizedConfig.openai_key = maskSensitiveInfo(sanitizedConfig.openai_key);
    }
    if (sanitizedConfig.s3_access_key) {
      sanitizedConfig.s3_access_key = maskSensitiveInfo(sanitizedConfig.s3_access_key);
    }
    if (sanitizedConfig.s3_secret_key) {
      sanitizedConfig.s3_secret_key = maskSensitiveInfo(sanitizedConfig.s3_secret_key);
    }
    
    return JSON.stringify(sanitizedConfig, null, 2);
  } catch (error) {
    console.error('导出配置失败', error);
    throw new Error(`导出配置失败: ${error.message}`);
  }
}

/**
 * 从JSON导入配置
 * @param {string} jsonData - JSON字符串
 * @returns {Promise<void>}
 */
export async function importConfig(jsonData) {
  try {
    const config = JSON.parse(jsonData);
    
    // 验证JSON格式
    if (typeof config !== 'object' || config === null) {
      throw new Error('无效的配置格式');
    }
    
    // 批量保存配置
    await chrome.storage.sync.set(config);
    console.log('配置导入成功');
  } catch (error) {
    console.error('导入配置失败', error);
    if (error instanceof SyntaxError) {
      throw new Error('配置文件格式错误，请选择有效的JSON文件');
    }
    throw new Error(`导入配置失败: ${error.message}`);
  }
}

/**
 * 清空所有配置
 * @returns {Promise<void>}
 */
export async function clearAllConfig() {
  try {
    await chrome.storage.sync.clear();
    console.log('所有配置已清空');
  } catch (error) {
    console.error('清空配置失败', error);
    throw new Error(`清空配置失败: ${error.message}`);
  }
}

/**
 * 初始化默认配置
 * @returns {Promise<void>}
 */
export async function initDefaultConfig() {
  const defaults = {
    // 标签配置
    tag_summary: '#网页/总结',
    tag_selection: '#网页/划词',
    tag_image: '#网页/图片',
    tag_clipping: '#网页/剪藏',
    
    // 通用设置
    include_link_summary: true,
    include_link_selection: true,
    include_link_image: true,
    include_link_quick_note: true,
    
    // 存储配置
    keep_original_image_link: true,
    
    // 懒加载触发配置
    enable_lazy_load_trigger: true,
    lazy_load_scroll_speed: 'medium',
    lazy_load_max_wait: 10,
    
    // 模板配置
    templates: [{
      name: '默认模板',
      content: '请总结以下网页内容，提取关键信息：{{content}}'
    }],
    default_template: '默认模板',
    domain_rules: [],
    
    // 域名标签配置
    domain_tag_rules: [],
    domain_tag_match_strategy: 'first'
  };
  
  // 只设置未配置的项
  const existingConfig = await getAllConfig();
  for (const [key, value] of Object.entries(defaults)) {
    if (existingConfig[key] === undefined) {
      await saveConfig(key, value);
    }
  }
}

/**
 * 脱敏敏感信息
 * @param {string} str - 原始字符串
 * @returns {string} 脱敏后的字符串
 */
function maskSensitiveInfo(str) {
  if (!str || str.length <= 8) {
    return '****';
  }
  const start = str.substring(0, 4);
  const end = str.substring(str.length - 4);
  return `${start}****${end}`;
}



