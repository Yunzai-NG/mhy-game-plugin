/**
 * 模块职责：原神专属命令的对外出口 —— 目录内各文件汇于一处
 * 依赖方向：只作转发，自身不含逻辑
 * 生命周期：无状态
 * 注意事项：命令表从这里取，不逐文件深引 —— 三个游戏各有一份同形的出口。
 */
export * from "./combat.js"
export * from "./gcg.js"
export * from "./hard-challenge.js"
export * from "./today-material.js"
