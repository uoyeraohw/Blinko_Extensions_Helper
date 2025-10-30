/**
 * 存储配额监控工具
 * 监控Chrome Storage和IndexedDB的使用情况
 */

/**
 * 获取存储配额信息
 * @returns {Promise<Object>} {quota, usage, usagePercent}
 */
export async function getStorageQuota() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota || 0,
        usage: estimate.usage || 0,
        usagePercent: estimate.quota ? ((estimate.usage / estimate.quota) * 100).toFixed(2) : 0
      };
    } else {
      // 降级：假设有足够的空间
      return {
        quota: -1, // 未知
        usage: 0,
        usagePercent: 0
      };
    }
  } catch (error) {
    console.error('[storage-quota] Failed to get storage quota:', error);
    return {
      quota: -1,
      usage: 0,
      usagePercent: 0
    };
  }
}

/**
 * 获取Chrome Storage使用情况
 * @returns {Promise<Object>} {bytesInUse, items}
 */
export async function getChromeStorageUsage() {
  try {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        chrome.storage.local.get(null, (items) => {
          resolve({
            bytesInUse: bytesInUse || 0,
            items: Object.keys(items).length
          });
        });
      });
    });
  } catch (error) {
    console.error('[storage-quota] Failed to get Chrome Storage usage:', error);
    return { bytesInUse: 0, items: 0 };
  }
}

/**
 * 获取IndexedDB使用情况（估算）
 * @param {string} dbName - 数据库名称
 * @param {string} storeName - 对象存储名称
 * @returns {Promise<Object>} {itemCount, estimatedBytes}
 */
export async function getIndexedDBUsage(dbName, storeName) {
  try {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);

      request.onerror = () => {
        resolve({ itemCount: 0, estimatedBytes: 0 });
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains(storeName)) {
          resolve({ itemCount: 0, estimatedBytes: 0 });
          return;
        }

        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const countRequest = store.count();

        countRequest.onsuccess = () => {
          const itemCount = countRequest.result;
          // 粗略估算每个项平均1KB
          const estimatedBytes = itemCount * 1024;
          
          resolve({ itemCount, estimatedBytes });
        };

        countRequest.onerror = () => {
          resolve({ itemCount: 0, estimatedBytes: 0 });
        };
      };
    });
  } catch (error) {
    console.error('[storage-quota] Failed to get IndexedDB usage:', error);
    return { itemCount: 0, estimatedBytes: 0 };
  }
}

/**
 * 检查配额状态
 * @returns {Promise<Object>} {status, message, percent}
 */
export async function checkQuota() {
  try {
    const quota = await getStorageQuota();
    const percent = parseFloat(quota.usagePercent);

    let status = 'normal';
    let message = '存储空间充足';

    if (percent >= 90) {
      status = 'critical';
      message = '存储空间严重不足，请立即清理';
    } else if (percent >= 80) {
      status = 'warning';
      message = '存储空间即将用尽，建议清理';
    } else if (percent >= 60) {
      status = 'notice';
      message = '存储空间使用较多';
    }

    return {
      status,
      message,
      percent,
      quota: quota.quota,
      usage: quota.usage
    };
  } catch (error) {
    console.error('[storage-quota] Failed to check quota:', error);
    return {
      status: 'unknown',
      message: '无法检查存储状态',
      percent: 0,
      quota: -1,
      usage: 0
    };
  }
}

/**
 * 获取详细的存储使用情况
 * @returns {Promise<Object>}
 */
export async function getDetailedUsage() {
  try {
    const [quota, chromeStorage, indexedDB] = await Promise.all([
      getStorageQuota(),
      getChromeStorageUsage(),
      getIndexedDBUsage('BlinkoOfflineQueue', 'queue_items')
    ]);

    // 估算草稿占用（从Chrome Storage中）
    const draftEstimate = await estimateDraftSize();

    return {
      total: {
        quota: quota.quota,
        usage: quota.usage,
        usagePercent: quota.usagePercent
      },
      chromeStorage: {
        bytes: chromeStorage.bytesInUse,
        items: chromeStorage.items,
        readableSize: formatBytes(chromeStorage.bytesInUse)
      },
      drafts: {
        bytes: draftEstimate,
        readableSize: formatBytes(draftEstimate)
      },
      queue: {
        items: indexedDB.itemCount,
        bytes: indexedDB.estimatedBytes,
        readableSize: formatBytes(indexedDB.estimatedBytes)
      }
    };
  } catch (error) {
    console.error('[storage-quota] Failed to get detailed usage:', error);
    return {
      total: { quota: -1, usage: 0, usagePercent: 0 },
      chromeStorage: { bytes: 0, items: 0, readableSize: '0 B' },
      drafts: { bytes: 0, readableSize: '0 B' },
      queue: { items: 0, bytes: 0, readableSize: '0 B' }
    };
  }
}

/**
 * 估算草稿占用空间
 * @returns {Promise<number>} 字节数
 */
async function estimateDraftSize() {
  try {
    const result = await chrome.storage.local.get(['quick_note_draft', 'saved_drafts']);
    
    let totalBytes = 0;
    
    if (result.quick_note_draft) {
      totalBytes += JSON.stringify(result.quick_note_draft).length;
    }
    
    if (result.saved_drafts && Array.isArray(result.saved_drafts)) {
      totalBytes += JSON.stringify(result.saved_drafts).length;
    }
    
    return totalBytes;
  } catch (error) {
    console.error('[storage-quota] Failed to estimate draft size:', error);
    return 0;
  }
}

/**
 * 格式化字节数为可读格式
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的字符串（如 "1.5 MB"）
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes === -1) return '未知';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * 检查是否需要清理
 * @returns {Promise<boolean>}
 */
export async function needsCleanup() {
  const quota = await checkQuota();
  return quota.status === 'warning' || quota.status === 'critical';
}

/**
 * 获取清理建议
 * @returns {Promise<Array>} 清理建议列表
 */
export async function getCleanupSuggestions() {
  const suggestions = [];
  
  try {
    const usage = await getDetailedUsage();
    const quota = await checkQuota();

    // 队列清理建议
    if (usage.queue.items > 50) {
      suggestions.push({
        type: 'queue',
        priority: usage.queue.items > 100 ? 'high' : 'medium',
        message: `离线队列有${usage.queue.items}项，建议清理成功和失败的项`,
        action: 'cleanup_queue'
      });
    }

    // 草稿清理建议
    const result = await chrome.storage.local.get('saved_drafts');
    const draftCount = (result.saved_drafts || []).length;
    if (draftCount > 10) {
      suggestions.push({
        type: 'drafts',
        priority: 'low',
        message: `已保存${draftCount}个命名草稿，建议清理不需要的草稿`,
        action: 'cleanup_drafts'
      });
    }

    // 配额警告
    if (quota.status === 'critical') {
      suggestions.push({
        type: 'critical',
        priority: 'critical',
        message: '存储空间严重不足，请立即清理数据',
        action: 'urgent_cleanup'
      });
    }

  } catch (error) {
    console.error('[storage-quota] Failed to get cleanup suggestions:', error);
  }

  return suggestions;
}

/**
 * 监听存储变化
 * @param {Function} callback - 回调函数
 */
export function monitorStorageChanges(callback) {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
      const usage = await getDetailedUsage();
      const quota = await checkQuota();
      callback({ usage, quota, changes });
    }
  });
}

