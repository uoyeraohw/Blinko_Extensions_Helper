/**
 * 草稿管理模块
 * 负责速写草稿的自动保存、恢复和管理
 */

/**
 * 保存当前草稿
 * @param {string} content - 草稿内容
 * @param {number} type - 笔记类型 (0:闪念, 1:笔记, 2:提醒)
 * @returns {Promise<boolean>} 保存是否成功
 */
export async function saveDraft(content, type = 0) {
  try {
    if (!content || content.trim() === '') {
      return false;
    }

    const draft = {
      content: content,
      type: type,
      timestamp: Date.now(),
      autoSaved: true
    };

    await chrome.storage.local.set({ quick_note_draft: draft });
    console.log('[draft-manager] Draft saved:', draft.timestamp);
    return true;
  } catch (error) {
    console.error('[draft-manager] Failed to save draft:', error);
    return false;
  }
}

/**
 * 加载当前草稿
 * @returns {Promise<Object|null>} 草稿对象或null
 */
export async function loadDraft() {
  try {
    const result = await chrome.storage.local.get('quick_note_draft');
    const draft = result.quick_note_draft;

    if (!draft) {
      return null;
    }

    // 检查草稿是否过期（7天）
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    if (now - draft.timestamp > sevenDaysInMs) {
      console.log('[draft-manager] Draft expired, clearing');
      await clearDraft();
      return null;
    }

    console.log('[draft-manager] Draft loaded:', draft.timestamp);
    return draft;
  } catch (error) {
    console.error('[draft-manager] Failed to load draft:', error);
    return null;
  }
}

/**
 * 清除当前草稿
 * @returns {Promise<boolean>} 清除是否成功
 */
export async function clearDraft() {
  try {
    await chrome.storage.local.remove('quick_note_draft');
    console.log('[draft-manager] Draft cleared');
    return true;
  } catch (error) {
    console.error('[draft-manager] Failed to clear draft:', error);
    return false;
  }
}

/**
 * 保存命名草稿
 * @param {string} name - 草稿名称
 * @param {string} content - 草稿内容
 * @param {number} type - 笔记类型
 * @returns {Promise<{success: boolean, id?: string, message?: string}>}
 */
export async function saveNamedDraft(name, content, type = 0) {
  try {
    if (!name || name.trim() === '') {
      return { success: false, message: '草稿名称不能为空' };
    }

    if (!content || content.trim() === '') {
      return { success: false, message: '草稿内容不能为空' };
    }

    // 获取现有草稿列表
    const result = await chrome.storage.local.get('saved_drafts');
    const drafts = result.saved_drafts || [];

    // 检查名称是否已存在
    const existingIndex = drafts.findIndex(d => d.name === name);
    
    if (existingIndex !== -1) {
      // 更新现有草稿
      drafts[existingIndex].content = content;
      drafts[existingIndex].type = type;
      drafts[existingIndex].updatedAt = Date.now();
      
      await chrome.storage.local.set({ saved_drafts: drafts });
      console.log('[draft-manager] Named draft updated:', name);
      return { success: true, id: drafts[existingIndex].id, message: '草稿已更新' };
    } else {
      // 创建新草稿
      const newDraft = {
        id: crypto.randomUUID(),
        name: name,
        content: content,
        type: type,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      drafts.push(newDraft);
      await chrome.storage.local.set({ saved_drafts: drafts });
      console.log('[draft-manager] Named draft created:', name);
      return { success: true, id: newDraft.id, message: '草稿已保存' };
    }
  } catch (error) {
    console.error('[draft-manager] Failed to save named draft:', error);
    return { success: false, message: '保存草稿失败: ' + error.message };
  }
}

/**
 * 获取所有命名草稿列表
 * @returns {Promise<Array>} 草稿列表（按更新时间倒序）
 */
export async function listDrafts() {
  try {
    const result = await chrome.storage.local.get('saved_drafts');
    const drafts = result.saved_drafts || [];
    
    // 按更新时间倒序排序
    drafts.sort((a, b) => b.updatedAt - a.updatedAt);
    
    console.log('[draft-manager] Listed drafts:', drafts.length);
    return drafts;
  } catch (error) {
    console.error('[draft-manager] Failed to list drafts:', error);
    return [];
  }
}

/**
 * 删除命名草稿
 * @param {string} id - 草稿ID
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function deleteDraft(id) {
  try {
    if (!id) {
      return { success: false, message: '草稿ID不能为空' };
    }

    const result = await chrome.storage.local.get('saved_drafts');
    const drafts = result.saved_drafts || [];
    
    const filteredDrafts = drafts.filter(d => d.id !== id);
    
    if (filteredDrafts.length === drafts.length) {
      return { success: false, message: '草稿不存在' };
    }

    await chrome.storage.local.set({ saved_drafts: filteredDrafts });
    console.log('[draft-manager] Draft deleted:', id);
    return { success: true, message: '草稿已删除' };
  } catch (error) {
    console.error('[draft-manager] Failed to delete draft:', error);
    return { success: false, message: '删除草稿失败: ' + error.message };
  }
}

/**
 * 获取指定草稿
 * @param {string} id - 草稿ID
 * @returns {Promise<Object|null>} 草稿对象或null
 */
export async function getDraft(id) {
  try {
    const result = await chrome.storage.local.get('saved_drafts');
    const drafts = result.saved_drafts || [];
    
    const draft = drafts.find(d => d.id === id);
    return draft || null;
  } catch (error) {
    console.error('[draft-manager] Failed to get draft:', error);
    return null;
  }
}

/**
 * 清空所有草稿（包括当前草稿和命名草稿）
 * @returns {Promise<boolean>}
 */
export async function clearAllDrafts() {
  try {
    await chrome.storage.local.remove(['quick_note_draft', 'saved_drafts']);
    console.log('[draft-manager] All drafts cleared');
    return true;
  } catch (error) {
    console.error('[draft-manager] Failed to clear all drafts:', error);
    return false;
  }
}

/**
 * 获取草稿配置
 * @returns {Promise<Object>} 草稿配置对象
 */
export async function getDraftSettings() {
  try {
    const result = await chrome.storage.local.get('draft_settings');
    return result.draft_settings || {
      autoSaveInterval: 2000, // 2秒
      retentionDays: 7 // 7天
    };
  } catch (error) {
    console.error('[draft-manager] Failed to get draft settings:', error);
    return {
      autoSaveInterval: 2000,
      retentionDays: 7
    };
  }
}

/**
 * 保存草稿配置
 * @param {Object} settings - 配置对象
 * @returns {Promise<boolean>}
 */
export async function saveDraftSettings(settings) {
  try {
    await chrome.storage.local.set({ draft_settings: settings });
    console.log('[draft-manager] Settings saved:', settings);
    return true;
  } catch (error) {
    console.error('[draft-manager] Failed to save settings:', error);
    return false;
  }
}

