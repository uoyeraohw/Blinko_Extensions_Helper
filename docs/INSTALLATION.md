# Blinko Chrome扩展 - 安装指南

## 快速安装（开发者模式）

### 前提条件
- Chrome浏览器（版本88或更高）
- 或其他Chromium内核浏览器（Edge、Brave、Opera等）

### 步骤1：准备图标文件

⚠️ **重要**：由于项目刚创建，需要先准备图标文件。

**临时方案（快速测试）：**
1. 下载任意PNG图片
2. 调整大小或直接使用（建议48x48）
3. 复制3份并重命名为：
   - `icons/icon16.png`
   - `icons/icon48.png`
   - `icons/icon128.png`

**正式方案：**
参考 `icons/README.md` 创建正式图标

### 步骤2：加载扩展

1. **打开Chrome扩展管理页面**
   - 方法1：在地址栏输入 `chrome://extensions/`
   - 方法2：菜单 → 更多工具 → 扩展程序
   - 方法3：右键扩展图标 → 管理扩展程序

2. **开启开发者模式**
   - 点击页面右上角的"开发者模式"开关
   - 开关变为蓝色表示已开启

3. **加载扩展**
   - 点击"加载已解压的扩展程序"
   - 选择项目根目录（包含manifest.json的目录）
   - 点击"选择文件夹"

4. **验证安装**
   - 扩展列表中出现"Blinko 网页剪藏助手"
   - 没有错误提示
   - 浏览器工具栏显示扩展图标

### 步骤3：初始配置

1. **打开设置页面**
   - 方法1：点击扩展图标 → "设置"标签
   - 方法2：右键扩展图标 → "选项"

2. **配置Blinko连接**
   - Tab 1: Blinko配置
   - 输入API URL（如：`https://your-blinko.com`）
   - 输入Authorization令牌
   - 点击"验证"确保连接成功

3. **配置OpenAI（可选）**
   - Tab 2: OpenAI配置
   - 输入API Key
   - 可选：配置Base URL和Model
   - 点击"验证"测试连接

4. **其他配置（可选）**
   - Tab 3: 创建自定义模板
   - Tab 4: 设置场景标签
   - Tab 5: 配置S3存储（如需图片转存）
   - Tab 6: 调整通用设置

### S3 存储配置（可选）

如果需要将网页图片上传到自己的 S3 存储：

1. **选择存储方式**
   - 保留原链接：直接使用网页图片原始URL
   - 上传到S3：将图片上传到自己的S3存储

2. **S3 必填参数**
   - `ACCESS_KEY`：S3访问密钥ID
   - `SECRET_KEY`：S3私密密钥
   - `ENDPOINT`：S3服务端点（如 `https://s3.amazonaws.com`）
   - `REGION`：区域（如 `us-east-1`）
   - `BUCKET`：存储桶名称

3. **S3 可选参数**
   - `CDN`：CDN加速域名（如 `https://cdn.example.com`）
   - `自定义路径`：存储路径前缀（如 `blinko/images`）

4. **常见 S3 服务配置示例**

**AWS S3:**
```
ENDPOINT: https://s3.amazonaws.com
REGION: us-east-1
BUCKET: my-bucket
```

**MinIO:**
```
ENDPOINT: https://minio.example.com
REGION: us-east-1
BUCKET: my-bucket
```

**阿里云 OSS (S3协议):**
```
ENDPOINT: https://oss-cn-hangzhou.aliyuncs.com
REGION: oss-cn-hangzhou
BUCKET: my-bucket
```

**腾讯云 COS (S3协议):**
```
ENDPOINT: https://cos.ap-guangzhou.myqcloud.com
REGION: ap-guangzhou
BUCKET: my-bucket-1234567890
```

5. **验证配置**
   - 点击"验证S3配置"按钮
   - 成功提示："S3连接成功！存储桶可访问"
   - 如果失败，检查错误提示并修正配置

## 使用验证

### 测试网页剪藏
1. 访问任意文章页面
2. 点击扩展图标
3. 点击"提取网页正文"
4. 预览框应显示Markdown格式内容
5. 点击"提交"保存到Blinko

### 测试AI总结
1. 确保已配置OpenAI
2. 访问文章页面
3. 点击扩展图标
4. 点击"提取并总结"
5. 等待AI生成总结
6. 预览并提交

### 测试速写
1. 点击扩展图标
2. 切换到"速写"标签
3. 输入内容
4. 点击"提交"或按Ctrl+Enter

## 常见问题

### Q1：扩展无法加载
**可能原因：**
- manifest.json格式错误
- 图标文件不存在
- 文件路径问题

**解决方案：**
1. 检查manifest.json语法
2. 确保icons目录下有所需图标
3. 查看控制台错误信息

### Q2：提取网页正文失败
**可能原因：**
- Content Script未注入
- 网页结构特殊

**解决方案：**
1. 刷新目标网页
2. 查看页面控制台是否有错误
3. 尝试其他网页

### Q3：AI总结失败
**可能原因：**
- OpenAI配置错误
- API额度不足
- 网络问题

**解决方案：**
1. 在设置中验证OpenAI配置
2. 检查API Key是否有效
3. 查看错误提示信息

### Q4：保存到Blinko失败
**可能原因：**
- Blinko配置错误
- 网络连接问题
- Authorization过期

**解决方案：**
1. 在设置中验证Blinko连接
2. 检查API URL和Authorization
3. 查看Blinko服务是否正常

### Q5：修改代码后不生效
**解决方案：**
1. 访问 `chrome://extensions/`
2. 找到扩展，点击刷新图标🔄
3. 重新打开popup或重新加载网页

## 更新扩展

### 从Git更新
```bash
cd Blinko_Extensions_Helper
git pull
```

然后：
1. 访问 `chrome://extensions/`
2. 点击扩展的刷新按钮🔄

### 重新加载
如果更新后出现问题：
1. 移除扩展
2. 重新加载（步骤2）
3. 重新配置（步骤3）

## 卸载扩展

### 方法1：扩展管理页面
1. 访问 `chrome://extensions/`
2. 找到"Blinko 网页剪藏助手"
3. 点击"移除"按钮
4. 确认删除

### 方法2：右键菜单
1. 右键扩展图标
2. 选择"从Chrome中移除"
3. 确认删除

### 数据清理
卸载扩展会自动删除所有本地数据（配置、缓存等）。

## 调试技巧

### 查看Popup日志
1. 右键扩展图标
2. "检查弹出内容"
3. 查看Console标签

### 查看Background Script日志
1. 访问 `chrome://extensions/`
2. 找到扩展
3. 点击"Service Worker"下的"检查视图"
4. 查看Console标签

### 查看Content Script日志
1. 在目标网页按F12
2. 查看Console标签
3. 过滤"Blinko"相关日志

### 查看Storage数据
1. 右键扩展图标 → "检查弹出内容"
2. Application标签 → Storage → Extension Storage
3. 查看所有存储的配置

## 高级选项

### 权限说明
扩展请求的权限：
- `storage` - 保存配置数据
- `tabs` - 获取当前页面信息
- `activeTab` - 访问当前页面内容
- `scripting` - 注入内容脚本
- `contextMenus` - 添加右键菜单
- `<all_urls>` - 在所有网页工作

### 性能优化
- 定期清理无用配置
- 限制模板和规则数量
- 大型网页可能需要更多时间

## 获取帮助

遇到问题？
1. 查看 [README.md](README.md)
2. 查看 [DEVELOPMENT.md](DEVELOPMENT.md)
3. 查看 [TESTING.md](TESTING.md)
4. 提交GitHub Issue
5. 查看错误日志

## 下一步

安装成功后：
1. ✅ 阅读 [README.md](README.md) 了解功能
2. ✅ 配置Blinko和OpenAI
3. ✅ 尝试剪藏第一篇文章
4. ✅ 探索更多功能
5. ✅ 分享给朋友

祝使用愉快！🎉

