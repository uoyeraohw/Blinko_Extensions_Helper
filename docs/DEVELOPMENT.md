# Blinko Chrome 扩展 - 开发者文档

## 项目架构

### 总体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Popup      │  │   Settings   │  │  Background  │ │
│  │  (popup.html)│  │(settings.html)│  │(background.js)│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │          │
│         └──────────────────┴──────────────────┘          │
│                          │                               │
│         ┌────────────────┴────────────────┐             │
│         │                                  │             │
│  ┌──────▼───────┐               ┌────────▼────────┐    │
│  │   Utils      │               │  Content Script │    │
│  │  - storage   │               │(content-script.js)│    │
│  │  - api       │               └─────────────────┘    │
│  │  - markdown  │                                       │
│  │  - s3        │                                       │
│  │  - template  │                                       │
│  └──────────────┘                                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
    ┌─────────────┐      ┌─────────────┐
    │   Blinko    │      │   OpenAI    │
    │     API     │      │     API     │
    └─────────────┘      └─────────────┘
```

### 目录结构说明

```
blinko_plugin/
├── manifest.json          # Chrome扩展清单
├── src/
│   ├── popup.html        # 弹出窗口UI
│   ├── popup.js          # 弹出窗口逻辑
│   ├── settings.html     # 设置页面UI
│   ├── settings.js       # 设置页面逻辑
│   ├── content-script.js # 内容脚本（注入网页）
│   ├── background.js     # 后台服务脚本
│   ├── utils/            # 工具函数库
│   │   ├── storage.js         # Chrome Storage封装
│   │   ├── html-to-markdown.js # HTML转Markdown
│   │   ├── api-client.js      # API客户端
│   │   ├── s3-uploader.js     # S3上传工具
│   │   └── template-matcher.js # 模板匹配引擎
│   └── styles/           # 样式文件
│       ├── popup.css
│       └── settings.css
├── icons/                # 扩展图标
├── dist/                 # 构建输出
└── openspec/             # OpenSpec规格文档
```

## 核心模块说明

### 1. Storage Module (storage.js)

负责所有配置数据的持久化存储。

**主要功能：**
- `saveConfig(key, value)` - 保存配置
- `getConfig(key, defaultValue)` - 读取配置
- `exportConfig()` - 导出配置为JSON
- `importConfig(jsonData)` - 从JSON导入配置

**数据存储：**
使用 `chrome.storage.sync` API，数据会在登录Chrome账号的设备间同步。

**存储的配置项：**
```javascript
{
  // Blinko配置
  blinko_api_url: string
  blinko_authorization: string
  
  // OpenAI配置
  openai_base_url: string
  openai_key: string
  openai_model: string
  
  // 模板
  templates: Array<{name: string, content: string}>
  default_template: string
  domain_rules: Array<{pattern: string, type: string, templateName: string}>
  
  // 标签
  tag_summary: string
  tag_selection: string
  tag_image: string
  tag_clipping: string
  
  // 通用设置
  include_link_summary: boolean
  include_link_selection: boolean
  include_link_image: boolean
  include_link_quick_note: boolean
  
  // S3配置
  keep_original_image_link: boolean
  s3_access_key: string
  s3_secret_key: string
  s3_endpoint: string
  s3_region: string
  s3_bucket: string
  s3_cdn: string
  s3_custom_path: string
}
```

### 2. HTML to Markdown Module (html-to-markdown.js)

将网页HTML内容转换为Markdown格式。

**核心函数：**
- `htmlToMarkdown(html, includeImages)` - 主转换函数
- `extractMainContent(doc)` - 提取主要内容区域
- `cleanDocument(doc)` - 清理无用元素

**转换规则：**
- 标题 (h1-h6) → `# 标题`
- 段落 (p) → 换行
- 粗体 (strong/b) → `**文本**`
- 斜体 (em/i) → `*文本*`
- 链接 (a) → `[文本](URL)`
- 图片 (img) → `![alt](URL)`
- 代码块 (pre/code) → ` ```代码``` `
- 列表 (ul/ol) → `- 项目` 或 `1. 项目`
- 表格 (table) → Markdown表格

### 3. API Client Module (api-client.js)

处理与外部API的通信。

**Blinko API：**
- `validateBlinkoConnection(apiUrl, token)` - 验证连接
- `createNote(apiUrl, token, content, type)` - 创建笔记

**OpenAI API：**
- `validateOpenAI(baseUrl, apiKey, model)` - 验证配置
- `summarizeContent(...)` - 总结内容

**错误处理：**
- 网络超时（30秒）
- HTTP错误状态码
- 自动重试机制（最多3次）

### 4. S3 Uploader Module (s3-uploader.js)

**注意：** 当前实现为简化版本，生产环境需要集成完整的AWS SDK。

**功能：**
- `validateS3Config(config)` - 验证配置
- `uploadImage(imageBlob, filename, s3Config)` - 上传图片
- `processImages(imageUrls, s3Config)` - 批量处理图片
- `replaceImageUrls(markdown, urlMap)` - 替换URL

**并发控制：**
最多同时上传5张图片，避免请求过多。

### 5. Template Matcher Module (template-matcher.js)

根据URL匹配合适的总结模板。

**匹配类型：**
1. **正则表达式** (`regex`) - 使用正则匹配URL
2. **主域名匹配** (`domain`) - 匹配主域名及子域名
3. **完整URL** (`exact`) - 精确匹配完整URL

**匹配优先级：**
域名规则按添加顺序匹配，第一个匹配的规则生效。

**变量替换：**
- 如果模板包含 `{{content}}`，替换后作为user prompt
- 否则，模板作为system prompt，内容作为user prompt

## 消息传递流程

### Popup → Content Script

```javascript
// popup.js
const response = await chrome.tabs.sendMessage(tabId, {
  action: 'extract-content'
});

// content-script.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract-content') {
    const html = extractPageContent();
    sendResponse({ success: true, html: html });
  }
});
```

### 右键菜单 → Background Script

```javascript
// background.js
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-selection-to-blinko') {
    handleSaveSelection(info, tab);
  }
});
```

## API调用流程

### 网页剪藏流程

```
1. 用户点击"提取网页正文"
   ↓
2. Popup发送消息到Content Script
   ↓
3. Content Script提取HTML并返回
   ↓
4. Popup调用htmlToMarkdown转换
   ↓
5. 如果配置了S3，上传图片并替换URL
   ↓
6. 添加标签和网页链接
   ↓
7. 显示在预览框
   ↓
8. 用户点击"提交"
   ↓
9. 调用Blinko API保存
```

### AI总结流程

```
1. 用户点击"提取并总结"
   ↓
2. 提取网页HTML并转换（不含图片）
   ↓
3. 根据URL匹配模板
   ↓
4. 替换模板变量
   ↓
5. 调用OpenAI API
   ↓
6. 返回总结结果
   ↓
7. 添加标签和链接
   ↓
8. 显示在预览框
```

## 开发环境设置

### 1. 克隆项目
```bash
git clone <repository-url>
cd blinko_plugin
```

### 2. 安装依赖（可选）
```bash
npm install
```

### 3. 加载扩展到Chrome

1. 打开 Chrome浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目根目录

### 4. 开发调试

**调试Popup：**
- 右键扩展图标 → "检查弹出内容"
- 或在popup打开时按F12

**调试Settings：**
- 右键扩展图标 → "选项" → F12

**调试Content Script：**
- 在目标网页按F12
- Console中会显示content script的日志

**调试Background Script：**
- `chrome://extensions/` → 找到扩展 → "Service Worker" → "检查视图"

### 5. 实时重载

修改代码后需要：
1. 访问 `chrome://extensions/`
2. 点击扩展的刷新按钮🔄
3. 重新打开popup或settings

## 代码规范

### JavaScript风格
- 使用ES6+ 语法
- 使用 `const` 和 `let`，避免 `var`
- 函数使用箭头函数或function声明
- 异步操作使用 `async/await`

### 命名约定
- 变量和函数：camelCase
- 常量：UPPER_SNAKE_CASE
- 类：PascalCase
- 文件名：kebab-case

### 注释
```javascript
/**
 * 函数说明
 * @param {string} param1 - 参数说明
 * @returns {Promise<Object>} 返回值说明
 */
async function example(param1) {
  // 实现
}
```

## 常见问题

### Q: 如何调试Content Script？
A: 在目标网页打开开发者工具(F12)，content script的日志会显示在Console中。

### Q: 修改代码后不生效？
A: 需要在chrome://extensions/页面刷新扩展，然后重新打开popup或重新加载网页。

### Q: Service Worker报错？
A: Manifest V3使用Service Worker替代Background Page，不支持DOM操作，只能使用Chrome APIs。

### Q: 如何测试S3上传？
A: 当前实现为简化版本，实际使用需要集成@aws-sdk/client-s3库。

## 性能优化建议

1. **减少Storage读写**：批量读写，避免频繁调用
2. **图片处理**：使用Web Worker处理大量图片
3. **懒加载**：按需加载大型库
4. **缓存**：缓存常用配置和模板
5. **并发控制**：限制同时进行的网络请求数量

## 安全注意事项

1. **API密钥**：永远不要硬编码API密钥
2. **XSS防护**：使用textContent而非innerHTML
3. **CSRF**：验证来源
4. **Content Security Policy**：遵守CSP规则
5. **权限最小化**：只请求必要的权限

## 贡献指南

1. Fork项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交Pull Request

## 参考资料

- [Chrome Extension文档](https://developer.chrome.com/docs/extensions/)
- [Manifest V3迁移指南](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Content Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)



