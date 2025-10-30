/**
 * HTML转Markdown工具
 * 将网页HTML内容转换为Markdown格式
 */

/**
 * 将HTML转换为Markdown
 * @param {string} html - HTML字符串
 * @param {boolean} includeImages - 是否包含图片（默认true）
 * @returns {Object} { markdown: string, images: Array }
 */
export function htmlToMarkdown(html, includeImages = true) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // 清理不需要的元素
  cleanDocument(doc);
  
  // 提取图片列表
  const images = extractImageUrls(doc);
  
  // 如果不包含图片，移除所有img标签
  if (!includeImages) {
    doc.querySelectorAll('img').forEach(img => img.remove());
  }
  
  // 转换为Markdown
  const markdown = convertElement(doc.body);
  
  return {
    markdown: markdown.trim(),
    images: images
  };
}

/**
 * 清理文档中的无用元素
 * @param {Document} doc - DOM文档
 */
function cleanDocument(doc) {
  // 移除脚本、样式、导航、侧边栏、广告等
  const selectorsToRemove = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'header', 'footer', 'aside',
    '.sidebar', '.advertisement', '.ads',
    '[class*="ad-"]', '[id*="ad-"]',
    '.social-share', '.comments',
    '#comments', '.related-posts'
  ];
  
  selectorsToRemove.forEach(selector => {
    doc.querySelectorAll(selector).forEach(el => el.remove());
  });
}

/**
 * 提取文档中所有图片URL
 * @param {Document} doc - DOM文档
 * @returns {Array<string>} 图片URL数组
 */
function extractImageUrls(doc) {
  const images = [];
  doc.querySelectorAll('img').forEach(img => {
    const src = img.src || img.getAttribute('data-src');
    if (src && !src.startsWith('data:') && src.length > 10) {
      images.push(src);
    }
  });
  return images;
}

/**
 * 递归转换DOM元素为Markdown
 * @param {Element} element - DOM元素
 * @param {number} listDepth - 列表深度
 * @returns {string} Markdown文本
 */
function convertElement(element, listDepth = 0) {
  if (!element) return '';
  
  let markdown = '';
  
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) {
        markdown += text + ' ';
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      
      switch (tag) {
        case 'h1':
          markdown += `\n\n# ${getTextContent(node)}\n\n`;
          break;
        case 'h2':
          markdown += `\n\n## ${getTextContent(node)}\n\n`;
          break;
        case 'h3':
          markdown += `\n\n### ${getTextContent(node)}\n\n`;
          break;
        case 'h4':
          markdown += `\n\n#### ${getTextContent(node)}\n\n`;
          break;
        case 'h5':
          markdown += `\n\n##### ${getTextContent(node)}\n\n`;
          break;
        case 'h6':
          markdown += `\n\n###### ${getTextContent(node)}\n\n`;
          break;
          
        case 'p':
          markdown += `\n\n${convertElement(node)}\n\n`;
          break;
          
        case 'br':
          markdown += '\n';
          break;
          
        case 'strong':
        case 'b':
          markdown += `**${getTextContent(node)}**`;
          break;
          
        case 'em':
        case 'i':
          markdown += `*${getTextContent(node)}*`;
          break;
          
        case 'a':
          const href = node.getAttribute('href') || '';
          const linkText = getTextContent(node);
          markdown += `[${linkText}](${href})`;
          break;
          
        case 'img':
          const src = node.src || node.getAttribute('data-src') || '';
          const alt = node.getAttribute('alt') || '图片';
          if (src) {
            markdown += `\n\n![${alt}](${src})\n\n`;
          }
          break;
          
        case 'code':
          if (node.parentElement.tagName.toLowerCase() === 'pre') {
            // 代码块已由pre标签处理
            break;
          }
          markdown += `\`${getTextContent(node)}\``;
          break;
          
        case 'pre':
          const codeContent = getTextContent(node);
          markdown += `\n\n\`\`\`\n${codeContent}\n\`\`\`\n\n`;
          break;
          
        case 'blockquote':
          const quoteLines = convertElement(node).split('\n');
          markdown += '\n\n' + quoteLines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
          break;
          
        case 'ul':
          markdown += '\n' + convertList(node, false, listDepth) + '\n';
          break;
          
        case 'ol':
          markdown += '\n' + convertList(node, true, listDepth) + '\n';
          break;
          
        case 'li':
          // li标签由convertList处理
          break;
          
        case 'table':
          markdown += '\n\n' + convertTable(node) + '\n\n';
          break;
          
        case 'hr':
          markdown += '\n\n---\n\n';
          break;
          
        default:
          markdown += convertElement(node, listDepth);
      }
    }
  }
  
  return markdown;
}

/**
 * 转换列表
 * @param {Element} listElement - ul或ol元素
 * @param {boolean} ordered - 是否有序列表
 * @param {number} depth - 嵌套深度
 * @returns {string} Markdown文本
 */
function convertList(listElement, ordered, depth = 0) {
  let markdown = '';
  const items = Array.from(listElement.children).filter(child => child.tagName.toLowerCase() === 'li');
  
  items.forEach((item, index) => {
    const indent = '  '.repeat(depth);
    const marker = ordered ? `${index + 1}.` : '-';
    const content = convertElement(item, depth + 1).trim();
    markdown += `${indent}${marker} ${content}\n`;
  });
  
  return markdown;
}

/**
 * 转换表格
 * @param {Element} tableElement - table元素
 * @returns {string} Markdown表格
 */
function convertTable(tableElement) {
  let markdown = '';
  
  const rows = Array.from(tableElement.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  
  // 处理表头
  const headerRow = rows[0];
  const headers = Array.from(headerRow.querySelectorAll('th, td')).map(cell => getTextContent(cell).trim());
  
  if (headers.length > 0) {
    markdown += '| ' + headers.join(' | ') + ' |\n';
    markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
  }
  
  // 处理数据行
  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td')).map(cell => getTextContent(cell).trim());
    if (cells.length > 0) {
      markdown += '| ' + cells.join(' | ') + ' |\n';
    }
  }
  
  return markdown;
}

/**
 * 获取元素的纯文本内容
 * @param {Element} element - DOM元素
 * @returns {string} 文本内容
 */
function getTextContent(element) {
  return element.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * 提取网页主要内容区域
 * @param {Document} doc - DOM文档
 * @returns {Element} 主要内容元素
 */
export function extractMainContent(doc) {
  // 优先查找主要内容标签
  const mainSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.main-content',
    '.post-content',
    '.article-content',
    '#content',
    '.content'
  ];
  
  for (const selector of mainSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      return element;
    }
  }
  
  // 如果找不到，返回body
  return doc.body;
}



