# 快速启动指南

## 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

## 验证 WebGPU 支持

打开浏览器控制台，运行：

```javascript
if (navigator.gpu) {
  console.log('✅ WebGPU 支持');
} else {
  console.log('❌ WebGPU 不支持');
}
```

## 测试流程

1. **首页** → 点击"新建试验"或"查看演示"
2. **风洞实验室** → 左侧面板切换到"模型"标签
3. **上传模型** → 拖拽 STL/OBJ 文件或使用演示模型
4. **设置参数** → 调整入口速度、湍流模型等
5. **开始仿真** → 点击顶部"开始"按钮
6. **查看结果** → 右侧面板查看升力/阻力系数

## 浏览器要求

- Chrome/Edge 113+
- Firefox 141+ (Nightly)
- Safari 26+ (Technology Preview)

## 故障排查

### WebGPU 不可用

如果看到"WebGPU 不可用"提示：

1. 检查浏览器版本
2. Chrome: 访问 `chrome://flags/#enable-unsafe-webgpu` 并启用
3. 使用 HTTPS 或 localhost

### 模型上传失败

- 检查文件格式（仅支持 STL/OBJ/glTF）
- 检查文件大小（最大 50MB）
- 查看浏览器控制台错误信息

### 仿真不运行

- 确保 WebGPU 已初始化（顶部显示"WebGPU 已就绪"）
- 检查浏览器控制台是否有错误
- 尝试降低网格分辨率

## 项目文件说明

- `src/app/page.tsx` - 首页（项目管理）
- `src/app/lab/page.tsx` - 风洞实验室主页面
- `src/lib/cfd/lbm-solver.ts` - LBM CFD 求解器
- `src/lib/models/parser.ts` - 3D 模型解析器
- `src/lib/stores/` - 状态管理（Zustand）
- `src/components/` - UI 组件

## 下一步开发

1. 实现真实的 3D 模型障碍物标记
2. 添加 Three.js 3D 可视化
3. 实现粒子系统和流线
4. 添加更多湍流模型
5. 支持 3D LBM（D3Q19）

## 技术文档

- [Next.js 16 文档](https://nextjs.org/docs)
- [React 19 文档](https://react.dev)
- [WebGPU 规范](https://www.w3.org/TR/webgpu/)
- [LBM 方法介绍](https://en.wikipedia.org/wiki/Lattice_Boltzmann_methods)
