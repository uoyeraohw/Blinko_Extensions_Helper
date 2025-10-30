/**
 * 离线队列模块
 * 负责在网络不可用时保存笔记请求，并在网络恢复后自动重试
 */

const DB_NAME = 'BlinkoOfflineQueue';
const DB_VERSION = 1;
const STORE_NAME = 'queue_items';
const DEFAULT_MAX_QUEUE_SIZE = 100;
const MAX_RETRY_COUNT = 6;

let db = null;
let useFallback = false; // 是否使用Chrome Storage作为降级方案

/**
 * 初始化IndexedDB数据库
 * @returns {Promise<IDBDatabase|null>}
 */
export async function initDB() {
  if (db) {
    return db;
  }

  try {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[offline-queue] IndexedDB open failed:', request.error);
        useFallback = true;
        resolve(null);
      };

      request.onsuccess = () => {
        db = request.result;
        console.log('[offline-queue] IndexedDB opened successfully');
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        
        // 创建对象存储
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = database.createObjectStore(STORE_NAME, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          // 创建索引
          objectStore.createIndex('status', 'status', { unique: false });
          objectStore.createIndex('createdAt', 'createdAt', { unique: false });
          objectStore.createIndex('retryCount', 'retryCount', { unique: false });
          
          console.log('[offline-queue] Object store created with indexes');
        }
      };
    });
  } catch (error) {
    console.error('[offline-queue] Failed to initialize IndexedDB:', error);
    useFallback = true;
    return null;
  }
}

/**
 * 添加项到队列
 * @param {Object} item - 队列项 {content, type, tags, url, title, metadata}
 * @returns {Promise<{success: boolean, id?: number, message?: string}>}
 */
export async function enqueue(item) {
  try {
    // 检查队列大小限制
    const queueSize = await getQueueSize();
    const maxSize = await getMaxQueueSize();
    
    if (queueSize >= maxSize) {
      return { 
        success: false, 
        message: `队列已满（${maxSize}条），请清理后重试` 
      };
    }

    // 检查重复内容（5分钟内）
    const isDuplicate = await checkDuplicate(item.content);
    if (isDuplicate) {
      return { 
        success: false, 
        message: '该笔记已在队列中' 
      };
    }

    const queueItem = {
      content: item.content,
      type: item.type || 0,
      tags: item.tags || '',
      url: item.url || '',
      title: item.title || '',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      lastError: '',
      metadata: item.metadata || {}
    };

    if (useFallback) {
      return await enqueueFallback(queueItem);
    }

    await initDB();
    
    if (!db) {
      return await enqueueFallback(queueItem);
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(queueItem);

      request.onsuccess = () => {
        console.log('[offline-queue] Item enqueued:', request.result);
        resolve({ success: true, id: request.result });
      };

      request.onerror = () => {
        console.error('[offline-queue] Failed to enqueue:', request.error);
        resolve({ success: false, message: '入队失败: ' + request.error });
      };
    });
  } catch (error) {
    console.error('[offline-queue] Enqueue error:', error);
    return { success: false, message: '入队失败: ' + error.message };
  }
}

/**
 * 使用Chrome Storage作为降级方案入队
 */
async function enqueueFallback(item) {
  try {
    const result = await chrome.storage.local.get('offline_queue_fallback');
    const queue = result.offline_queue_fallback || [];
    
    // 限制降级队列大小为50
    if (queue.length >= 50) {
      return { success: false, message: '队列已满（降级模式限制50条）' };
    }

    item.id = Date.now() + Math.random(); // 简单ID生成
    queue.push(item);
    
    await chrome.storage.local.set({ offline_queue_fallback: queue });
    console.log('[offline-queue] Item enqueued (fallback):', item.id);
    return { success: true, id: item.id };
  } catch (error) {
    console.error('[offline-queue] Fallback enqueue failed:', error);
    return { success: false, message: '入队失败: ' + error.message };
  }
}

/**
 * 从队列移除项
 * @param {number} id - 队列项ID
 * @returns {Promise<boolean>}
 */
export async function dequeue(id) {
  try {
    if (useFallback) {
      return await dequeueFallback(id);
    }

    await initDB();
    
    if (!db) {
      return await dequeueFallback(id);
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log('[offline-queue] Item dequeued:', id);
        resolve(true);
      };

      request.onerror = () => {
        console.error('[offline-queue] Failed to dequeue:', request.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('[offline-queue] Dequeue error:', error);
    return false;
  }
}

async function dequeueFallback(id) {
  try {
    const result = await chrome.storage.local.get('offline_queue_fallback');
    const queue = result.offline_queue_fallback || [];
    const filtered = queue.filter(item => item.id !== id);
    await chrome.storage.local.set({ offline_queue_fallback: filtered });
    return true;
  } catch (error) {
    console.error('[offline-queue] Fallback dequeue failed:', error);
    return false;
  }
}

/**
 * 获取队列列表
 * @param {string} statusFilter - 状态过滤 ('all', 'pending', 'retrying', 'failed', 'success')
 * @returns {Promise<Array>}
 */
export async function getQueue(statusFilter = 'all') {
  try {
    if (useFallback) {
      return await getQueueFallback(statusFilter);
    }

    await initDB();
    
    if (!db) {
      return await getQueueFallback(statusFilter);
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        let items = request.result || [];
        
        // 按状态过滤
        if (statusFilter !== 'all') {
          items = items.filter(item => item.status === statusFilter);
        }
        
        // 按创建时间倒序排序
        items.sort((a, b) => b.createdAt - a.createdAt);
        
        console.log('[offline-queue] Queue retrieved:', items.length);
        resolve(items);
      };

      request.onerror = () => {
        console.error('[offline-queue] Failed to get queue:', request.error);
        resolve([]);
      };
    });
  } catch (error) {
    console.error('[offline-queue] Get queue error:', error);
    return [];
  }
}

async function getQueueFallback(statusFilter) {
  try {
    const result = await chrome.storage.local.get('offline_queue_fallback');
    let items = result.offline_queue_fallback || [];
    
    if (statusFilter !== 'all') {
      items = items.filter(item => item.status === statusFilter);
    }
    
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items;
  } catch (error) {
    console.error('[offline-queue] Fallback get queue failed:', error);
    return [];
  }
}

/**
 * 更新队列项
 * @param {number} id - 队列项ID
 * @param {Object} updates - 更新的字段
 * @returns {Promise<boolean>}
 */
export async function updateItem(id, updates) {
  try {
    if (useFallback) {
      return await updateItemFallback(id, updates);
    }

    await initDB();
    
    if (!db) {
      return await updateItemFallback(id, updates);
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        
        if (!item) {
          console.error('[offline-queue] Item not found:', id);
          resolve(false);
          return;
        }

        // 合并更新
        Object.assign(item, updates, { updatedAt: Date.now() });
        
        const putRequest = store.put(item);
        
        putRequest.onsuccess = () => {
          console.log('[offline-queue] Item updated:', id);
          resolve(true);
        };
        
        putRequest.onerror = () => {
          console.error('[offline-queue] Failed to update:', putRequest.error);
          resolve(false);
        };
      };

      getRequest.onerror = () => {
        console.error('[offline-queue] Failed to get item:', getRequest.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('[offline-queue] Update item error:', error);
    return false;
  }
}

async function updateItemFallback(id, updates) {
  try {
    const result = await chrome.storage.local.get('offline_queue_fallback');
    const queue = result.offline_queue_fallback || [];
    const index = queue.findIndex(item => item.id === id);
    
    if (index === -1) {
      return false;
    }
    
    Object.assign(queue[index], updates, { updatedAt: Date.now() });
    await chrome.storage.local.set({ offline_queue_fallback: queue });
    return true;
  } catch (error) {
    console.error('[offline-queue] Fallback update failed:', error);
    return false;
  }
}

/**
 * 清理队列
 * @param {Object} options - 清理选项 {olderThan, status}
 * @returns {Promise<number>} 清理的项数
 */
export async function cleanup(options = {}) {
  try {
    const queue = await getQueue('all');
    const now = Date.now();
    let removed = 0;

    for (const item of queue) {
      let shouldRemove = false;

      // 清理成功项（3分钟后）
      if (item.status === 'success') {
        const threeMinutes = 3 * 60 * 1000;
        if (now - item.updatedAt > threeMinutes) {
          shouldRemove = true;
        }
      }

      // 清理指定状态
      if (options.status && item.status === options.status) {
        shouldRemove = true;
      }

      // 清理超过指定时间的项
      if (options.olderThan && now - item.createdAt > options.olderThan) {
        shouldRemove = true;
      }

      if (shouldRemove) {
        await dequeue(item.id);
        removed++;
      }
    }

    console.log('[offline-queue] Cleanup completed:', removed, 'items removed');
    return removed;
  } catch (error) {
    console.error('[offline-queue] Cleanup error:', error);
    return 0;
  }
}

/**
 * 获取队列大小
 * @returns {Promise<number>}
 */
export async function getQueueSize() {
  const queue = await getQueue('all');
  return queue.length;
}

/**
 * 检查是否有重复内容
 * @param {string} content - 内容
 * @returns {Promise<boolean>}
 */
async function checkDuplicate(content) {
  const queue = await getQueue('all');
  const fiveMinutes = 5 * 60 * 1000;
  const now = Date.now();

  return queue.some(item => 
    item.content === content && 
    (now - item.createdAt) < fiveMinutes
  );
}

/**
 * 获取最大队列大小配置
 * @returns {Promise<number>}
 */
async function getMaxQueueSize() {
  try {
    const result = await chrome.storage.local.get('offline_queue_settings');
    const settings = result.offline_queue_settings || {};
    return settings.maxSize || DEFAULT_MAX_QUEUE_SIZE;
  } catch (error) {
    return DEFAULT_MAX_QUEUE_SIZE;
  }
}

/**
 * 获取队列设置
 * @returns {Promise<Object>}
 */
export async function getQueueSettings() {
  try {
    const result = await chrome.storage.local.get('offline_queue_settings');
    return result.offline_queue_settings || {
      maxSize: 100,
      autoRetry: true,
      retryStrategy: 'standard', // 'conservative', 'standard', 'aggressive'
      successRetention: 180000, // 3分钟
      failureNotification: 'final' // 'disabled', 'final', 'every'
    };
  } catch (error) {
    console.error('[offline-queue] Failed to get settings:', error);
    return {
      maxSize: 100,
      autoRetry: true,
      retryStrategy: 'standard',
      successRetention: 180000,
      failureNotification: 'final'
    };
  }
}

/**
 * 保存队列设置
 * @param {Object} settings - 设置对象
 * @returns {Promise<boolean>}
 */
export async function saveQueueSettings(settings) {
  try {
    await chrome.storage.local.set({ offline_queue_settings: settings });
    console.log('[offline-queue] Settings saved:', settings);
    return true;
  } catch (error) {
    console.error('[offline-queue] Failed to save settings:', error);
    return false;
  }
}

/**
 * 计算重试延迟（指数退避）
 * @param {number} retryCount - 当前重试次数
 * @param {string} strategy - 重试策略
 * @returns {number} 延迟毫秒数
 */
export function calculateRetryDelay(retryCount, strategy = 'standard') {
  const delays = {
    conservative: [1000, 2000, 4000], // 最多3次
    standard: [1000, 2000, 4000, 8000, 16000, 32000], // 最多6次
    aggressive: [1000, 1000, 2000, 2000, 4000, 8000, 16000, 32000, 60000, 120000] // 最多10次
  };

  const delayList = delays[strategy] || delays.standard;
  const index = Math.min(retryCount, delayList.length - 1);
  return delayList[index];
}

/**
 * 检查是否应该继续重试
 * @param {number} retryCount - 当前重试次数
 * @param {string} strategy - 重试策略
 * @returns {boolean}
 */
export function shouldRetry(retryCount, strategy = 'standard') {
  const maxRetries = {
    conservative: 3,
    standard: 6,
    aggressive: 10
  };

  return retryCount < (maxRetries[strategy] || 6);
}

/**
 * 清空整个队列
 * @returns {Promise<boolean>}
 */
export async function clearQueue() {
  try {
    if (useFallback) {
      await chrome.storage.local.remove('offline_queue_fallback');
      return true;
    }

    await initDB();
    
    if (!db) {
      await chrome.storage.local.remove('offline_queue_fallback');
      return true;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[offline-queue] Queue cleared');
        resolve(true);
      };

      request.onerror = () => {
        console.error('[offline-queue] Failed to clear queue:', request.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('[offline-queue] Clear queue error:', error);
    return false;
  }
}

/**
 * 导出队列为JSON
 * @returns {Promise<string>}
 */
export async function exportQueue() {
  try {
    const queue = await getQueue('all');
    return JSON.stringify(queue, null, 2);
  } catch (error) {
    console.error('[offline-queue] Export queue error:', error);
    return '[]';
  }
}

/**
 * 检查IndexedDB是否可用
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
  return !useFallback && !!db;
}

