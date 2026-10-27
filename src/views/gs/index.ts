/**
 * 模块职责：原神专属视图的对外出口 —— 目录内各文件汇于一处
 * 依赖方向：只作转发，自身不含逻辑
 * 生命周期：无状态
 * 注意事项：目录外一律从这里取、不逐文件深引（三游戏各有一份同形出口，文件怎么分是目录自己的事）。
 *          目录内互引仍走文件本身（经本文件会成环）。
 */
export * from "./act-calendar.js"
export * from "./char-master.js"
export * from "./combat.js"
export * from "./gcg.js"
export * from "./hard-challenge.js"
export * from "./note.js"
export * from "./player.js"
export * from "./today-material.js"
