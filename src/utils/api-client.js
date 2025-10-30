/**
 * API客户端
 * 处理与Blinko和OpenAI的API通信
 */

import { t } from './i18n.js';
import { enqueue, getQueueSettings } from './offline-queue.js';

/**
 * 验证Blinko连接
 * @param {string} apiUrl - Blinko API URL
 * @param {string} token - 授权令牌
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function validateBlinkoConnection(apiUrl, token) {
  try {
    if (!apiUrl || !token) {
      return { success: false, message: t('api_error_configIncomplete') };
    }
    
    const url = `${apiUrl.replace(/\/$/, '')}/api/v1/tags/list`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, message: t('api_error_authFailed') };
      }
      return { success: false, message: t('api_error_httpStatus', response.status.toString()) };
    }
    
    const data = await response.json();
    console.log('Blinko连接成功', data);
    return { success: true, message: t('api_success_connected') };
    
  } catch (error) {
    console.error('Blinko连接失败', error);
    return { success: false, message: t('api_error_networkConnection', error.message) };
  }
}

/**
 * 创建Blinko笔记
 * @param {string} apiUrl - Blinko API URL
 * @param {string} token - 授权令牌
 * @param {string} content - 笔记内容
 * @param {number} type - 笔记类型 (0:闪念, 1:笔记, 2:提醒)
 * @param {Object} metadata - 扩展元数据（用于队列追踪）
 * @returns {Promise<{success: boolean, message: string, data?: any, queued?: boolean}>}
 */
export async function createNote(apiUrl, token, content, type = 0, metadata = {}) {
  try {
    if (!apiUrl || !token) {
      return { success: false, message: t('api_error_noBlinkoConfig') };
    }
    
    if (!content || content.trim() === '') {
      return { success: false, message: t('status_error_emptyContent') };
    }
    
    const url = `${apiUrl.replace(/\/$/, '')}/api/v1/note/upsert`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        content: content,
        type: type
      })
    });
    
    if (!response.ok) {
      // 认证错误不入队（重试也会失败）
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: t('api_error_authFailedCheck') };
      }
      
      // 服务器错误（5xx）- 应该入队重试
      if (response.status >= 500) {
        const queueResult = await tryEnqueueNote(content, type, metadata, `服务器错误 ${response.status}`);
        if (queueResult.success) {
          return { 
            success: false, 
            message: t('queue_enqueued_server_error'), 
            queued: true 
          };
        }
      }
      
      return { success: false, message: t('api_error_saveHttpStatus', response.status.toString()) };
    }
    
    const data = await response.json();
    return { success: true, message: t('api_success_noteSaved'), data: data };
    
  } catch (error) {
    console.error('创建笔记失败', error);
    
    // 网络错误 - 应该入队重试
    const queueResult = await tryEnqueueNote(content, type, metadata, error.message);
    if (queueResult.success) {
      return { 
        success: false, 
        message: t('queue_enqueued_network_error'), 
        queued: true 
      };
    }
    
    return { success: false, message: t('error_networkError', error.message) };
  }
}

/**
 * 尝试将笔记添加到离线队列
 * @param {string} content - 笔记内容
 * @param {number} type - 笔记类型
 * @param {Object} metadata - 元数据
 * @param {string} error - 错误信息
 * @returns {Promise<{success: boolean}>}
 */
async function tryEnqueueNote(content, type, metadata, error) {
  try {
    // 检查是否启用自动队列
    const settings = await getQueueSettings();
    if (!settings.autoRetry) {
      console.log('[api-client] Auto retry disabled, not enqueueing');
      return { success: false };
    }
    
    const result = await enqueue({
      content: content,
      type: type,
      tags: '', // 标签已包含在content中
      url: metadata.url || '',
      title: metadata.title || '',
      metadata: {
        ...metadata,
        initialError: error
      }
    });
    
    if (result.success) {
      console.log('[api-client] Note enqueued for retry:', result.id);
      return { success: true };
    }
    
    return { success: false };
  } catch (error) {
    console.error('[api-client] Failed to enqueue note:', error);
    return { success: false };
  }
}

/**
 * 重试队列中的笔记
 * @param {Object} queueItem - 队列项
 * @param {string} apiUrl - Blinko API URL
 * @param {string} token - 授权令牌
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function retryQueuedNote(queueItem, apiUrl, token) {
  // 重试时不再入队，直接返回结果
  const tempCreateNote = async (url, tok, content, type) => {
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/note/upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tok}`
        },
        body: JSON.stringify({ content, type })
      });
      
      if (!response.ok) {
        return { 
          success: false, 
          message: `HTTP ${response.status}` 
        };
      }
      
      const data = await response.json();
      return { success: true, message: '重试成功', data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };
  
  return await tempCreateNote(apiUrl, token, queueItem.content, queueItem.type);
}

/**
 * 验证OpenAI配置
 * @param {string} baseUrl - OpenAI API Base URL
 * @param {string} apiKey - API Key
 * @param {string} model - 模型名称
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function validateOpenAI(baseUrl, apiKey, model) {
  try {
    if (!apiKey) {
      return { success: false, message: t('api_error_noApiKey') };
    }
    
    const url = baseUrl || 'https://api.openai.com/v1';
    const modelName = model || 'gpt-3.5-turbo';
    
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'user', content: 'hi' }
        ],
        max_tokens: 10
      })
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: t('error_apiKeyInvalid') };
      }
      if (response.status === 404) {
        return { success: false, message: t('error_modelNotAvailable') };
      }
      return { success: false, message: t('api_error_httpStatus', response.status.toString()) };
    }
    
    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content || '';
    return { 
      success: true, 
      message: t('api_success_connectedWithResponse', generatedText) 
    };
    
  } catch (error) {
    console.error('OpenAI验证失败', error);
    return { success: false, message: t('api_error_cannotConnect', error.message) };
  }
}

/**
 * 使用OpenAI总结内容
 * @param {string} baseUrl - OpenAI API Base URL
 * @param {string} apiKey - API Key
 * @param {string} model - 模型名称
 * @param {string} systemPrompt - 系统提示词
 * @param {string} content - 要总结的内容
 * @returns {Promise<{success: boolean, message: string, summary?: string}>}
 */
export async function summarizeContent(baseUrl, apiKey, model, systemPrompt, content) {
  try {
    if (!apiKey) {
      return { success: false, message: '请先在设置中配置OpenAI' };
    }
    
    if (!content || content.trim() === '') {
      return { success: false, message: t('status_error_contentTooShort') };
    }
    
    const url = baseUrl || 'https://api.openai.com/v1';
    const modelName = model || 'gpt-3.5-turbo';
    
    // 构建消息
    const messages = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: content });
    
    // 设置超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
    
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: t('error_apiKeyInvalid') };
      }
      if (response.status === 429) {
        return { success: false, message: t('error_apiQuotaExceeded') };
      }
      return { success: false, message: t('api_error_summarizeHttpStatus', response.status.toString()) };
    }
    
    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || '';
    
    if (!summary) {
      return { success: false, message: t('error_noSummaryGenerated') };
    }
    
    return { success: true, message: t('api_success_summarized'), summary: summary };
    
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, message: t('error_timeout') };
    }
    console.error('总结失败', error);
    return { success: false, message: t('status_error_summarizeFailed', error.message) };
  }
}

/**
 * 带重试机制的fetch
 * @param {string} url - 请求URL
 * @param {Object} options - fetch选项
 * @param {number} retries - 重试次数
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || i === retries - 1) {
        return response;
      }
      // 如果不是最后一次尝试，等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

/**
 * 优化提示词模板（转换为system prompt）
 * @param {string} baseUrl - OpenAI API Base URL
 * @param {string} apiKey - API Key
 * @param {string} model - 模型名称
 * @param {string} originalTemplate - 原始模板内容
 * @returns {Promise<{success: boolean, message: string, optimizedTemplate?: string}>}
 */
export async function optimizeTemplate(baseUrl, apiKey, model, originalTemplate) {
  try {
    if (!apiKey) {
      return { success: false, message: '请先在设置中配置OpenAI' };
    }
    
    if (!originalTemplate || originalTemplate.trim() === '') {
      return { success: false, message: t('error_templateEmpty') };
    }
    
    const url = baseUrl || 'https://api.openai.com/v1';
    const modelName = model || 'gpt-3.5-turbo';
    
    // 场景引导型优化策略的system prompt
    const systemPrompt = `你是一个专业的AI提示词工程师，擅长将用户的简单想法转换为高质量的system prompt。

## 任务
用户会提供一个用于网页内容处理的原始模板（可能很简单或不够专业）。你需要将其优化为一个完整、专业的system prompt。

## 分析步骤
1. **识别意图**：判断用户想要做什么（总结、提取、分析、翻译、评论等）
2. **识别场景**：注意原始模板中是否提到特定网站或领域（如GitHub、知乎、技术文档、新闻等）
3. **提取要求**：保留用户明确提出的核心要求（如输出格式、重点关注的内容等）

## 优化规则
### 结构要求
- **使用第一人称**定义AI角色（"我是..."而不是"你是..."）
- 包含清晰的角色定位和能力描述
- 明确说明任务目标和处理方式
- 如有必要，指定输出格式和质量标准

### 场景适配
- **通用场景**：保持适度灵活性，关注核心信息提取
- **特定场景**（如GitHub、知乎、技术博客等）：
  - 添加该领域的专业术语和关注点
  - 针对性地指导分析维度（如GitHub关注技术栈、星数、文档质量等）

### 关键注意事项
- ❌ **不要包含** \`{{content}}\` 等占位符（优化后的模板是纯system prompt）
- ✅ 保留用户的核心意图和特殊要求
- ✅ 使用专业、简洁的语言
- ✅ 避免模糊表达，具体化要求

## 输出格式
直接返回优化后的完整system prompt文本，不要添加任何前缀、后缀或解释说明。

## 示例
输入："总结GitHub仓库"
输出应类似：
"我是一个专业的开源项目分析师，擅长快速理解和总结GitHub仓库的核心价值。

针对GitHub仓库页面，我会重点关注：
- 项目的核心功能和技术特点
- 使用的主要技术栈和框架
- 项目的活跃度（星数、贡献者、最近更新）
- README文档的质量和完整性
- 适用场景和目标用户

输出格式：简洁的段落式总结，突出项目亮点和实用价值。"`;

    const userPrompt = originalTemplate;
    
    // 设置30秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: t('error_apiKeyInvalid') };
      }
      if (response.status === 429) {
        return { success: false, message: t('error_apiQuotaExceeded') };
      }
      return { success: false, message: t('api_error_optimizeHttpStatus', response.status.toString()) };
    }
    
    const data = await response.json();
    const optimizedTemplate = data.choices?.[0]?.message?.content || '';
    
    if (!optimizedTemplate) {
      return { success: false, message: t('error_noSummaryGenerated') };
    }
    
    return { 
      success: true, 
      message: t('api_success_templateOptimized'), 
      optimizedTemplate: optimizedTemplate.trim() 
    };
    
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, message: t('error_timeout') };
    }
    console.error('模板优化失败', error);
    return { success: false, message: t('settings_templates_error_optimizeFailed', error.message) };
  }
}



