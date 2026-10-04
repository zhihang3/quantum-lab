# 量子实验室 · 布洛赫球与量子线路

交互式量子计算教学演示：

- **单比特布洛赫球**：量子门（X/Y/Z/H/S/T）、绕任意轴旋转、拉比振荡、退相干/弛豫、测量
- **多比特量子线路**：比特门与两比特门（CNOT/CZ/SWAP）、纠缠、约化密度矩阵、纠缠熵、测量采样

## 使用

直接用浏览器打开 index.html 即可，无需安装任何东西（纯单文件，零依赖）。

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库（如 quantum-lab）
2. 上传 index.html 到仓库根目录（或直接 git push）
3. 仓库 **Settings → Pages → Source** 选择 Deploy from a branch，分支选 main，保存
4. 稍等 1~2 分钟，访问 https://<用户名>.github.io/<仓库名>/

## 开发

- 核心物理与界面测试：
ode _test.js（76 项，全部通过）
