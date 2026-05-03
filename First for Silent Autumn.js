(async function () {
    'use strict';

    const DB_NAME = 'ZodFarmDB';
    const DB_VERSION = 1;
    const CONFIG_KEY = 'farm_config';
    const PLOT_COUNT = 12; // 4列×3行
    /* 每个庇护所独立存储，key = farm_state_{shelterName} */
    function stateKey(shelterName) { return 'farm_state_' + shelterName; }

    // ==================== 作物定义 ====================
    const CROPS = {
        '土豆':   { icon: '🥔', growMin: 3,  yield: 3, weight: 0.3, desc: '耐寒高产作物', resist: 0.7 },
        '胡萝卜': { icon: '🥕', growMin: 5,  yield: 2, weight: 0.2, desc: '富含维生素', resist: 0.5 },
        '白菜':   { icon: '🥬', growMin: 4,  yield: 2, weight: 0.5, desc: '易于种植', resist: 0.6 },
        '番茄':   { icon: '🍅', growMin: 6,  yield: 3, weight: 0.2, desc: '需精心照料', resist: 0.3 },
        '玉米':   { icon: '🌽', growMin: 8,  yield: 2, weight: 0.4, desc: '高热量作物', resist: 0.6 },
        '小麦':   { icon: '🌾', growMin: 10, yield: 5, weight: 0.1, desc: '基础粮食', resist: 0.8 },
        '辣椒':   { icon: '🌶️', growMin: 5, yield: 2, weight: 0.1, desc: '调味作物', resist: 0.4 },
        '南瓜':   { icon: '🎃', growMin: 12, yield: 1, weight: 2.0, desc: '高产大块头', resist: 0.5 },
    };

    const STAGES = [
        { name: '种子',  icon: '🌰', pct: 0 },
        { name: '发芽',  icon: '🌱', pct: 25 },
        { name: '生长',  icon: '🌿', pct: 55 },
        { name: '成熟',  icon: null, pct: 85 },   // null = 显示作物自身图标
        { name: '可收获', icon: null, pct: 100 },  // null = 显示作物自身图标
    ];

    // ==================== 随机事件定义 ====================
    const EVENT_TYPES = {
        drought:  { icon: '🏜️', name: '干旱',   desc: '作物缺水了！生长停滞', color: '#f97316', actionName: '浇水' },
        weeds:    { icon: '🌿', name: '杂草',   desc: '杂草疯长，争夺养分', color: '#65a30d', actionName: '除草' },
        pests:    { icon: '🐛', name: '虫害',   desc: '害虫正在啃食作物！可能降低产量', color: '#ef4444', actionName: '除虫' },
        barren:   { icon: '🪨', name: '土地贫瘠', desc: '土壤养分不足，产量下降', color: '#78716c', actionName: '施肥' },
        thief:    { icon: '🦝', name: '小偷',   desc: '有小偷来偷庄稼了！', color: '#a855f7', actionName: '驱赶' },
    };

    // ==================== 道具定义 ====================
    const ITEMS = {
        waterCan:   { icon: '💧', name: '水壶',   resolves: 'drought', desc: '浇水+35，解除干旱', attrKey: 'water', attrAdd: 35 },
        weedKiller: { icon: '✂️', name: '除草剂', resolves: 'weeds',   desc: '除草+20健康，清除杂草', attrKey: 'health', attrAdd: 20 },
        bugSpray:   { icon: '🧴', name: '除虫剂', resolves: 'pests',   desc: '除虫+25健康，消灭害虫', attrKey: 'health', attrAdd: 25 },
        fertilizer: { icon: '🧪', name: '肥料',   resolves: 'barren',  desc: '施肥+35，恢复肥力', attrKey: 'fertilizer', attrAdd: 35 },
    };
    const MAX_ITEM_COUNT = 10;
    const ITEM_REGEN_INTERVAL = 120000; // 每2分钟恢复1个道具（120000ms = 2min）

    // ==================== 默认状态 ====================
    const DEFAULT_ITEMS = { waterCan: 2, weedKiller: 2, bugSpray: 2, fertilizer: 2 };
    let farmState = {
        plots: new Array(PLOT_COUNT).fill(null),
        harvestLog: [],
        events: {},
        stolenLog: [],
        items: { ...DEFAULT_ITEMS },
        lastItemRegen: Date.now(),
    };
    let farmConfig = {
        panelLeft: '50%', panelTop: '50%',
        panelWidth: '380px', panelHeight: '500px',
        bubbleTop: '35vh', bubbleLeft: '10px',
        isMinimized: true,
    };

    // ==================== IndexedDB ====================
    /**
     * 打开 IndexedDB 数据库连接
     * @returns {Promise<IDBDatabase>} 数据库实例
     */
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('state')) {
                    db.createObjectStore('state', { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * 从 IndexedDB 读取数据
     * @param {string} key - 存储键名
     * @returns {Promise<any>} 存储的值，不存在时返回 undefined
     */
    async function dbGet(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('state', 'readonly').objectStore('state').get(key);
            req.onsuccess = () => { db.close(); resolve(req.result?.value); };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    }
    /**
     * 向 IndexedDB 写入数据
     * @param {string} key - 存储键名
     * @param {any} value - 要存储的值
     * @returns {Promise<void>}
     */
    async function dbPut(key, value) {
        const db = await openDB();
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ key, value });
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }
    /**
     * 重置农场状态到初始值
     */
    function resetFarmState() {
        farmState.plots = new Array(PLOT_COUNT).fill(null);
        farmState.harvestLog = [];
        farmState.events = {};
        farmState.stolenLog = [];
        farmState.items = { ...DEFAULT_ITEMS };
        farmState.lastItemRegen = Date.now();
    }

    /**
     * 从 IndexedDB 加载指定庇护所的农场状态
     * @param {string} shelterName - 庇护所名称
     */
    async function loadState(shelterName) {
        try {
            const key = stateKey(shelterName);
            const s = await dbGet(key);
            if (s) {
                farmState.plots = s.plots || new Array(PLOT_COUNT).fill(null);
                farmState.harvestLog = s.harvestLog || [];
                farmState.events = s.events || {};
                farmState.stolenLog = s.stolenLog || [];
                farmState.items = { ...DEFAULT_ITEMS, ...(s.items || {}) };
                farmState.lastItemRegen = s.lastItemRegen || Date.now();
            } else {
                resetFarmState();
            }
        } catch (e) { console.warn('[小农场] 加载状态失败:', e); }
    }

    async function loadConfig() {
        try {
            const c = await dbGet(CONFIG_KEY);
            if (c) farmConfig = { ...farmConfig, ...c };
        } catch (e) { console.warn('[小农场] 加载配置失败:', e); }
    }

    /**
     * 保存当前农场状态到 IndexedDB
     * @param {string} [shelterName] - 庇护所名称，不传则使用当前选中的庇护所
     */
    async function saveState(shelterName) {
        const name = shelterName || selectedShelter;
        const key = stateKey(name);
        await dbPut(key, {
            plots: farmState.plots,
            harvestLog: farmState.harvestLog,
            events: farmState.events,
            stolenLog: farmState.stolenLog,
            items: farmState.items,
            lastItemRegen: farmState.lastItemRegen,
        });
        await saveFarmToMvu(name);
    }

    /**
     * 保存 UI 配置到 IndexedDB
     * @param {Object} [overrides={}] - 要覆盖的配置项
     */
    async function saveConfig(overrides = {}) {
        farmConfig = { ...farmConfig, ...overrides };
        await dbPut(CONFIG_KEY, farmConfig);
    }

    // ==================== MVU / SillyTavern API ====================
    let mvuReady = false;
    let cachedTargetMsgId = null;

    async function initMvu() {
        try {
            if (typeof waitGlobalInitialized === 'function') {
                await waitGlobalInitialized('Mvu');
            }
            if (typeof Mvu !== 'undefined') {
                mvuReady = true;
                console.log('[小农场] MVU连接成功（冷读取模式）');
            } else {
                console.warn('[小农场] Mvu 不可用');
            }
        } catch (e) {
            console.warn('[小农场] MVU初始化失败:', e);
        }
    }

    function coldReadLatestStatData() {
        if (!mvuReady) return null;
        try {
            const lastMsgId = typeof getLastMessageId === 'function' ? getLastMessageId() : null;
            if (lastMsgId === null || lastMsgId < 1) return null;
            const messages = typeof getChatMessages === 'function'
                ? getChatMessages('1-' + lastMsgId, { role: 'assistant' })
                : null;
            if (!messages || messages.length === 0) return null;
            for (let i = messages.length - 1; i >= Math.max(0, messages.length - 15); i--) {
                const targetMsgId = messages[i].message_id;
                if (targetMsgId <= 0) continue; // 跳过第0层，避免触发StatusPlaceHolder注入
                const data = Mvu.getMvuData({ type: 'message', message_id: targetMsgId });
                const sd = data?.stat_data;
                if (sd && Object.keys(sd).length > 0) {
                    cachedTargetMsgId = targetMsgId;
                    return { statData: sd, targetMsgId };
                }
            }
            return null;
        } catch (e) {
            console.warn('[小农场] 冷读取MVU数据失败:', e);
            return null;
        }
    }

    function quickReadStatData() {
        if (!mvuReady || cachedTargetMsgId === null) return null;
        try {
            const data = Mvu.getMvuData({ type: 'message', message_id: cachedTargetMsgId });
            const sd = data?.stat_data;
            if (sd && Object.keys(sd).length > 0) return sd;
            cachedTargetMsgId = null;
            return null;
        } catch (e) {
            cachedTargetMsgId = null;
            return null;
        }
    }

    function getLatestFullData() {
        if (!mvuReady) return null;
        try {
            if (cachedTargetMsgId !== null && cachedTargetMsgId > 0) {
                const data = Mvu.getMvuData({ type: 'message', message_id: cachedTargetMsgId });
                if (data?.stat_data && Object.keys(data.stat_data).length > 0) {
                    return { data, targetMsgId: cachedTargetMsgId };
                }
            }
            const lastMsgId = typeof getLastMessageId === 'function' ? getLastMessageId() : null;
            if (lastMsgId === null || lastMsgId < 1) return null;
            const messages = typeof getChatMessages === 'function'
                ? getChatMessages('1-' + lastMsgId, { role: 'assistant' })
                : null;
            if (!messages || messages.length === 0) return null;
            for (let i = messages.length - 1; i >= Math.max(0, messages.length - 15); i--) {
                const targetMsgId = messages[i].message_id;
                if (targetMsgId <= 0) continue; // 跳过第0层
                const data = Mvu.getMvuData({ type: 'message', message_id: targetMsgId });
                if (data?.stat_data && Object.keys(data.stat_data).length > 0) {
                    cachedTargetMsgId = targetMsgId;
                    return { data, targetMsgId };
                }
            }
            return null;
        } catch (e) {
            console.warn('[小农场] getLatestFullData 失败:', e);
            return null;
        }
    }

    async function getShelters(useQuickRead = false) {
        let sd;
        if (useQuickRead) {
            sd = quickReadStatData();
            if (!sd) {
                const result = coldReadLatestStatData();
                sd = result?.statData || null;
            }
        } else {
            const result = coldReadLatestStatData();
            sd = result?.statData || null;
        }
        if (!sd || !sd.建筑 || typeof sd.建筑 !== 'object') return {};
        return sd.建筑;
    }

    async function storeCropToShelter(cropName, count, shelterName) {
        if (!mvuReady) return false;
        try {
            const result = getLatestFullData();
            if (!result) return false;
            const { data, targetMsgId } = result;
            const sd = data.stat_data;
            if (!sd.建筑 || !sd.建筑[shelterName]) return false;
            if (!sd.建筑[shelterName].storage || typeof sd.建筑[shelterName].storage !== 'object') {
                sd.建筑[shelterName].storage = {};
            }
            const crop = CROPS[cropName];
            const existing = sd.建筑[shelterName].storage[cropName];
            const existingCount = existing ? parseCount(existing.detail || '') : 0;
            const newCount = existingCount + count;
            sd.建筑[shelterName].storage[cropName] = {
                detail: `${crop.icon} ${cropName}${newCount > 1 ? ' ×' + newCount : ''}`,
                weight: +(crop.weight * newCount).toFixed(1),
            };
            await Mvu.replaceMvuData(data, { type: 'message', message_id: targetMsgId });
            // 存入后失效缓存，确保下次读取新数据
            cachedTargetMsgId = null;
            // 手动触发 VARIABLE_UPDATE_ENDED 让状态栏即时刷新
            try {
                if (typeof eventEmit === 'function' && Mvu?.events?.VARIABLE_UPDATE_ENDED) {
                    eventEmit(Mvu.events.VARIABLE_UPDATE_ENDED);
                }
            } catch (e) { console.warn('[小农场] 状态栏刷新事件触发失败:', e); }
            return true;
        } catch (e) {
            console.error('[小农场] 存入庇护所失败:', e);
            return false;
        }
    }

    function parseCount(detail) {
        if (!detail) return 1;
        const m = detail.match(/[×xX]\s*(\d+)/);
        if (m) return parseInt(m[1]);
        return 1;
    }

    // ==================== MVU 跨设备同步 ====================

    /**
     * 查找任意可用消息 ID（不要求含 stat_data），用于存储农场数据
     * 优先使用含 stat_data 的消息（与庇护所数据同源），找不到则用最新的助手消息
     */
    function findAnyMessageId() {
        if (!mvuReady) return null;
        try {
            const lastMsgId = typeof getLastMessageId === 'function' ? getLastMessageId() : null;
            if (lastMsgId === null || lastMsgId < 1) return null;
            const messages = typeof getChatMessages === 'function'
                ? getChatMessages('1-' + lastMsgId, { role: 'assistant' })
                : null;
            if (!messages || messages.length === 0) return null;
            // 优先找含 stat_data 的消息
            for (let i = messages.length - 1; i >= Math.max(0, messages.length - 15); i--) {
                const mid = messages[i].message_id;
                if (mid <= 0) continue;
                const d = Mvu.getMvuData({ type: 'message', message_id: mid });
                if (d?.stat_data && Object.keys(d.stat_data).length > 0) return mid;
            }
            // 没有 stat_data 的消息，退而用最新的助手消息
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].message_id > 0) return messages[i].message_id;
            }
            return null;
        } catch (e) { return null; }
    }

    /**
     * 将当前农场状态同步写入 MVU（服务端存储），实现手机/电脑数据统一
     */
    async function saveFarmToMvu(shelterName) {
        if (!mvuReady) return;
        try {
            const targetMsgId = findAnyMessageId();
            if (!targetMsgId) return;
            const data = Mvu.getMvuData({ type: 'message', message_id: targetMsgId }) || {};
            if (!data.farm) data.farm = { shelters: {} };
            const name = shelterName || selectedShelter || farmConfig.selectedShelter;
            if (name) {
                data.farm.shelters[name] = {
                    plots: farmState.plots,
                    harvestLog: farmState.harvestLog,
                    events: farmState.events,
                    stolenLog: farmState.stolenLog,
                    items: farmState.items,
                    lastItemRegen: farmState.lastItemRegen,
                };
                data.farm.selectedShelter = selectedShelter || farmConfig.selectedShelter || name;
            }
            await Mvu.replaceMvuData(data, { type: 'message', message_id: targetMsgId });
            cachedTargetMsgId = null;
        } catch (e) {
            console.warn('[小农场] MVU 同步写入失败:', e);
        }
    }

    /**
     * 从 MVU 拉取所有庇护所的农场数据，写入本地 IndexedDB
     */
    async function syncFromMvu() {
        if (!mvuReady) return false;
        try {
            const lastMsgId = typeof getLastMessageId === 'function' ? getLastMessageId() : null;
            if (lastMsgId === null || lastMsgId < 1) return false;
            const messages = typeof getChatMessages === 'function'
                ? getChatMessages('1-' + lastMsgId, { role: 'assistant' })
                : null;
            if (!messages || messages.length === 0) return false;
            // 扫描所有近期消息，找到含 farm 数据的那条
            for (let i = messages.length - 1; i >= Math.max(0, messages.length - 30); i--) {
                const mid = messages[i].message_id;
                if (mid <= 0) continue;
                const data = Mvu.getMvuData({ type: 'message', message_id: mid });
                if (data?.farm?.shelters && Object.keys(data.farm.shelters).length > 0) {
                    for (const [name, state] of Object.entries(data.farm.shelters)) {
                        await dbPut(stateKey(name), state);
                    }
                    if (data.farm.selectedShelter) {
                        farmConfig.selectedShelter = data.farm.selectedShelter;
                    }
                    console.log('[小农场] 从 MVU 同步成功，消息ID:', mid);
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.warn('[小农场] MVU 同步拉取失败:', e);
            return false;
        }
    }

    // ==================== 生长计算（考虑事件影响） ====================
    function getPlotStage(plot, plotIdx) {
        if (!plot) return null;
        const crop = CROPS[plot.crop];
        if (!crop) return null;
        let elapsed = (Date.now() - plot.plantedAt) / 60000;

        const evt = farmState.events[plotIdx];
        if (evt && !evt.resolved) {
            // 出现负面状态时停止生长，冻结在事件发生时的进度
            const eventElapsed = (evt.startedAt - plot.plantedAt) / 60000;
            elapsed = Math.min(elapsed, Math.max(0, eventElapsed));
        }

        const progress = Math.min(1, elapsed / crop.growMin);
        const stageIdx = progress >= 1 ? 4 : progress >= 0.85 ? 3 : progress >= 0.55 ? 2 : progress >= 0.25 ? 1 : 0;
        return { progress, stageIdx, stage: STAGES[stageIdx], elapsed, totalMin: crop.growMin };
    }

    function calcYield(plot, plotIdx) {
        const crop = CROPS[plot.crop];
        if (!crop) return 0;
        let y = crop.yield;
        const evt = farmState.events[plotIdx];
        if (evt && !evt.resolved) {
            if (evt.type === 'pests') y = Math.max(1, Math.floor(y * 0.4));
            if (evt.type === 'barren') y = Math.max(1, Math.floor(y * 0.6));
            if (evt.type === 'weeds') y = Math.max(1, Math.floor(y * 0.8)); // 杂草减产20%
        }
        return y;
    }

    // ==================== 随机事件系统 ====================
    let eventCheckInterval = null;

    /**
     * 随机事件检查：触发干旱、虫害、小偷等事件
     * 每30秒执行一次，对生长中的作物进行概率判定
     */
    function checkRandomEvents() {
        let changed = false;
        const growingPlots = farmState.plots
            .map((p, i) => ({ plot: p, idx: i }))
            .filter(({ plot, idx }) => plot && !farmState.events[idx] && getPlotStage(plot, idx)?.stageIdx < 4);

        for (const { plot, idx } of growingPlots) {
            if (Math.random() < 0.04) {
                const crop = CROPS[plot.crop];
                if (Math.random() < (crop?.resist || 0.5)) continue;

                const plotInfo = getPlotStage(plot, idx);
                const isMature = plotInfo?.stageIdx >= 3;
                const types = Object.keys(EVENT_TYPES);
                // 成熟期小偷权重翻倍
                const weights = isMature ? [2, 1, 2, 1, 4] : [3, 2, 2, 2, 1];
                const totalW = weights.reduce((a, b) => a + b, 0);
                let r = Math.random() * totalW;
                let chosenType = types[0];
                for (let i = 0; i < weights.length; i++) {
                    r -= weights[i];
                    if (r <= 0) { chosenType = types[i]; break; }
                }

                if (chosenType === 'thief') {
                    const stolenAmount = Math.max(1, Math.floor((crop?.yield || 2) * 0.5));
                    farmState.stolenLog.push({ time: Date.now(), text: `🦝 小偷偷走了 ${crop.icon}${plot.crop} ×${stolenAmount}`, crop: plot.crop, amount: stolenAmount });
                    showToast(`🦝 小偷偷走了 ${crop.icon}${plot.crop} ×${stolenAmount}！`, true);
                } else {
                    farmState.events[idx] = { type: chosenType, startedAt: Date.now(), resolved: false };
                    const et = EVENT_TYPES[chosenType];
                    showToast(`${et.icon} 田地${idx + 1}的${plot.crop}出现${et.name}！`, true);
                }
                changed = true;
            }
        }

        // 虫害超时10分钟→作物枯死（7分钟时预警）
        for (const [idx, evt] of Object.entries(farmState.events)) {
            if (evt.resolved) continue;
            const elapsed = (Date.now() - evt.startedAt) / 60000;
            if (evt.type === 'pests' && elapsed > 7 && !evt._warned) {
                evt._warned = true;
                const plot = farmState.plots[parseInt(idx)];
                if (plot) showToast(`🐛⚠️ 田地${parseInt(idx) + 1}的${plot.crop}虫害严重！即将枯死！`, true);
            }
            if (evt.type === 'pests' && elapsed > 10) {
                const cropInfo = CROPS[farmState.plots[parseInt(idx)]?.crop];
                farmState.plots[parseInt(idx)] = null;
                delete farmState.events[parseInt(idx)];
                farmState.harvestLog.push({ time: Date.now(), text: `💀 ${cropInfo?.icon || '🌾'}作物因虫害枯死` });
                showToast(`💀 田地${parseInt(idx) + 1}的作物因虫害枯死了！`, true);
                changed = true;
            }
        }

        // 可收获超过15分钟→腐烂
        for (let i = 0; i < farmState.plots.length; i++) {
            const plot = farmState.plots[i];
            if (!plot) continue;
            const info = getPlotStage(plot, i);
            if (info && info.stageIdx === 4) {
                const ripeMinutes = (Date.now() - plot.plantedAt) / 60000 - (info.totalMin || 0);
                if (ripeMinutes > 15) {
                    const cropInfo = CROPS[plot.crop];
                    farmState.plots[i] = null;
                    delete farmState.events[i];
                    farmState.harvestLog.push({ time: Date.now(), text: `🦠 ${cropInfo?.icon || '🌾'}${plot.crop}因过熟腐烂了` });
                    showToast(`🦠 田地${i + 1}的${plot.crop}腐烂了！`, true);
                    changed = true;
                }
            }
        }

        if (changed) {
            saveState();
            renderPanel();
        }
    }

    /**
     * 启动随机事件检查定时器
     * 每30秒检查一次，面板打开时才执行实际检查
     */
    function startEventCheck() {
        if (eventCheckInterval) clearInterval(eventCheckInterval);
        eventCheckInterval = setInterval(() => {
            checkRandomEvents();
        }, 30000);
    }

    /**
     * 使用道具（每次只使用1个，不会一次性用完）
     * @param {string} itemKey - 道具键名
     * @param {number} plotIdx - 田地索引
     * @returns {boolean} 是否使用成功
     */
    function useItemOnPlot(itemKey, plotIdx) {
        const plot = farmState.plots[plotIdx];
        if (!plot) {
            showToast('该田地没有作物');
            return false;
        }
        const info = getPlotStage(plot, plotIdx);
        if (info.stageIdx >= 4) {
            showToast('作物已可收获，直接收获吧');
            return false;
        }
        const item = ITEMS[itemKey];
        if (!item) return false;

        if ((farmState.items[itemKey] || 0) <= 0) {
            showToast(`❌ ${item.name}已用完！等待自动补充`, true);
            return false;
        }

        const evt = farmState.events[plotIdx];
        const hasEvent = evt && !evt.resolved;

        // 有事件但道具不匹配
        if (hasEvent && item.resolves !== evt.type) {
            const et = EVENT_TYPES[evt.type];
            const neededItem = Object.values(ITEMS).find(i => i.resolves === evt.type);
            showToast(`❌ ${item.name}无法解除${et.name}！需要${neededItem?.icon || ''}${neededItem?.name || ''}`, true);
            return false;
        }

        // 每次只使用1个道具
        farmState.items[itemKey]--;

        // 解除事件
        let eventMsg = '';
        if (hasEvent && item.resolves === evt.type) {
            const et = EVENT_TYPES[evt.type];
            delete farmState.events[plotIdx];
            eventMsg = `，${et.name}已解除`;
        }

        // 恢复属性
        const attrKey = item.attrKey;
        if (attrKey && plot[attrKey] != null) {
            plot[attrKey] = Math.min(100, plot[attrKey] + item.attrAdd);
        }

        saveState();
        renderPanel();
        const attrName = { water: '水量', fertilizer: '肥力', health: '健康' }[attrKey] || '';
        showToast(`${item.icon} ${item.name}使用成功！${attrName}+${item.attrAdd}${eventMsg}`);
        return true;
    }

    /**
     * 道具自动恢复系统
     * 每2分钟恢复1个道具（最多10个），无庇护所时不恢复
     */
    function regenItems() {
        const shelterNames = Object.keys(currentShelters);
        if (shelterNames.length === 0) return;
        const now = Date.now();
        const elapsed = now - (farmState.lastItemRegen || now);
        const regenCount = Math.floor(elapsed / ITEM_REGEN_INTERVAL);
        if (regenCount <= 0) return;
        let changed = false;
        for (const key of Object.keys(ITEMS)) {
            if (farmState.items[key] < MAX_ITEM_COUNT) {
                farmState.items[key] = Math.min(MAX_ITEM_COUNT, farmState.items[key] + regenCount);
                changed = true;
            }
        }
        if (changed) {
            farmState.lastItemRegen = now;
            saveState();
            renderPanel();
        }
    }

    /**
     * 作物属性衰减系统
     * 每5秒执行一次：水量、肥力自然衰减，事件加速衰减，健康归零导致枯死
     */
    function decayPlotAttrs() {
        let changed = false;
        for (let i = 0; i < farmState.plots.length; i++) {
            const plot = farmState.plots[i];
            if (!plot) continue;
            // 可收获不衰减
            const info = getPlotStage(plot, i);
            if (info.stageIdx >= 4) continue;
            if (plot.water == null) plot.water = 80;
            if (plot.fertilizer == null) plot.fertilizer = 75;
            if (plot.health == null) plot.health = 100;

            const evt = farmState.events[i];
            const hasEvent = evt && !evt.resolved;

            // 自然衰减（每5秒tick一次：水-0.8≈6分钟从100到5，肥-0.5≈10分钟从100到5）
            plot.water = Math.max(0, plot.water - 0.8);
            plot.fertilizer = Math.max(0, plot.fertilizer - 0.5);

            // 事件加速衰减（约2-3分钟内恶化到危险线）
            if (hasEvent) {
                if (evt.type === 'drought') plot.water = Math.max(0, plot.water - 1.5);
                if (evt.type === 'barren') plot.fertilizer = Math.max(0, plot.fertilizer - 1.0);
                if (evt.type === 'pests') plot.health = Math.max(0, plot.health - 1.2);
                if (evt.type === 'weeds') plot.health = Math.max(0, plot.health - 0.6);
            }

            // 水量低时健康下降（模拟缺水伤害）
            if (plot.water < 20) plot.health = Math.max(0, plot.health - 0.5);

            // 属性过低自动触发事件（作为属性系统的正反馈）
            if (!hasEvent) {
                if (plot.water < 20 && Math.random() < 0.12) {
                    farmState.events[i] = { type: 'drought', startedAt: Date.now(), resolved: false };
                    changed = true;
                } else if (plot.fertilizer < 20 && Math.random() < 0.12) {
                    farmState.events[i] = { type: 'barren', startedAt: Date.now(), resolved: false };
                    changed = true;
                }
            }

            // 健康归零→枯死
            if (plot.health <= 0) {
                const cropInfo = CROPS[plot.crop];
                farmState.plots[i] = null;
                delete farmState.events[i];
                farmState.harvestLog.push({ time: Date.now(), text: `💀 ${cropInfo?.icon || '🌾'}作物因健康状况恶化枯死` });
                showToast(`💀 田地${i + 1}的作物枯死了！`, true);
                changed = true;
            }
        }
        if (changed) {
            saveState();
            renderPanel();
        }
    }

    // 一键收获
    async function harvestAll() {
        const readyPlots = [];
        for (let i = 0; i < farmState.plots.length; i++) {
            const plot = farmState.plots[i];
            if (!plot) continue;
            const info = getPlotStage(plot, i);
            if (info && info.stageIdx === 4) {
                readyPlots.push({ idx: i, plot, y: calcYield(plot, i) });
            }
        }
        if (readyPlots.length === 0) {
            showToast('没有可收获的作物');
            return;
        }
        let summary = {};
        for (const { idx, plot, y } of readyPlots) {
            farmState.plots[idx] = null;
            delete farmState.events[idx];
            if (!summary[plot.crop]) summary[plot.crop] = 0;
            summary[plot.crop] += y;
            farmState.harvestLog.push({ time: Date.now(), text: `收获 ${CROPS[plot.crop].icon}${plot.crop} ×${y} → ${selectedShelter}` });
        }
        await saveState();
        renderPanel();
        const msg = Object.entries(summary).map(([name, count]) => `${CROPS[name].icon}${name}×${count}`).join(' ');
        showToast(`📦 一键收获: ${msg}`);
        for (const [cropName, count] of Object.entries(summary)) {
            storeCropToShelter(cropName, count, selectedShelter);
        }
        refreshShelters(false);
    }

    // 显示作物详情
    function showCropDetail(plot, idx, info) {
        // 移除已有的详情弹窗（防止重复打开）
        p.document.querySelectorAll('.crop-detail-popup').forEach(el => el.remove());

        const crop = CROPS[plot.crop];
        const water = plot.water ?? 80;
        const fertilizer = plot.fertilizer ?? 75;
        const health = plot.health ?? 100;
        const waterLow = water < 30 ? ' low' : '';
        const fertLow = fertilizer < 30 ? ' low' : '';
        const healthLow = health < 30 ? ' low' : '';
        const remaining = Math.max(0, info.totalMin - info.elapsed);
        const evt = farmState.events[idx];
        const hasEvent = evt && !evt.resolved;

        const overlay = p.document.createElement('div');
        overlay.className = 'crop-detail-popup';
        if (panel.classList.contains('farm-force-light')) overlay.classList.add('farm-detail-light');

        let eventHtml = '';
        if (hasEvent) {
            const et = EVENT_TYPES[evt.type];
            eventHtml = `<div style="margin-top:10px;padding:8px;background:rgba(249,115,22,0.1);border-radius:6px;border:1px solid rgba(249,115,22,0.25);"><span style="color:#fb923c;font-weight:600;">${et.icon} ${et.name}</span><div style="font-size:12px;color:#a1a1aa;margin-top:2px;">${et.desc}</div></div>`;
        }

        overlay.innerHTML = `
            <div class="crop-detail-card">
                <div class="crop-detail-header">
                    <div class="crop-detail-icon">${crop.icon}</div>
                    <div>
                        <div class="crop-detail-name">${plot.crop}</div>
                        <div class="crop-detail-stage">${info.stage.name} · ${Math.round(info.progress * 100)}%</div>
                    </div>
                </div>
                <div class="crop-detail-attrs">
                    <div class="crop-detail-attr">
                        <span class="crop-detail-attr-icon">💧</span>
                        <div class="crop-detail-attr-bar"><div class="crop-detail-attr-fill water${waterLow}" style="width:${water}%"></div></div>
                        <span class="crop-detail-attr-val">${Math.round(water)}</span>
                    </div>
                    <div class="crop-detail-attr">
                        <span class="crop-detail-attr-icon">🧪</span>
                        <div class="crop-detail-attr-bar"><div class="crop-detail-attr-fill fert${fertLow}" style="width:${fertilizer}%"></div></div>
                        <span class="crop-detail-attr-val">${Math.round(fertilizer)}</span>
                    </div>
                    <div class="crop-detail-attr">
                        <span class="crop-detail-attr-icon">❤️</span>
                        <div class="crop-detail-attr-bar"><div class="crop-detail-attr-fill health${healthLow}" style="width:${health}%"></div></div>
                        <span class="crop-detail-attr-val">${Math.round(health)}</span>
                    </div>
                </div>
                ${eventHtml}
                <div class="crop-detail-info">
                    📊 产量: ×${calcYield(plot, idx)} (基础×${crop.yield})<br>
                    ⏱️ 预计剩余: ${formatMin(remaining)}<br>
                    🛡️ 抗性: ${Math.round(crop.resist * 100)}%
                </div>
                <div class="crop-detail-close">
                    <button class="harvest-btn cancel" id="cd-close">关闭</button>
                </div>
            </div>`;

        p.document.body.appendChild(overlay);
        overlay.querySelector('#cd-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // ==================== CSS ====================
    const CSS = `
    <style>
        .farm-main-panel {
            position: fixed; background: rgba(14, 20, 12, 0.97); backdrop-filter: blur(16px);
            border: 1px solid rgba(34, 197, 94, 0.3); box-shadow: 0 12px 48px rgba(0,0,0,0.7), 0 0 24px rgba(34,197,94,0.1);
            z-index: 999999; font-family: 'Inter', 'Microsoft YaHei', sans-serif;
            display: flex; flex-direction: column; border-radius: 14px;
            color: #e4e4e7; font-size: 15px; overflow: hidden;
            max-width: 95vw; max-height: 90vh; -webkit-tap-highlight-color: transparent;
            box-sizing: border-box;
        }
        .farm-main-panel::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, #166534, #22c55e, #4ade80, #22c55e, #166534);
            border-radius: 12px 12px 0 0;
        }

        #farm-bubble {
            position: fixed; width: 50px; height: 50px; background: rgba(14, 20, 12, 0.96);
            border: 2px solid #22c55e; border-radius: 50%;
            z-index: 1000000; cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 24px; transition: left 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
            touch-action: none; -webkit-tap-highlight-color: transparent;
            box-shadow: 0 0 16px rgba(34,197,94,0.35);
        }
        #farm-bubble:hover { box-shadow: 0 0 22px rgba(34,197,94,0.55); }
        #farm-bubble.has-event { border-color: #f97316; animation: farm-event-bubble 1.5s ease-in-out infinite; }
        @keyframes farm-event-bubble {
            0%, 100% { box-shadow: 0 0 15px rgba(249,115,22,0.3); }
            50% { box-shadow: 0 0 25px rgba(249,115,22,0.6); }
        }

        .farm-header {
            padding: 0 14px; height: 46px; background: rgba(34, 197, 94, 0.1);
            display: flex; align-items: center; justify-content: space-between;
            border-bottom: 1px solid rgba(34,197,94,0.25); cursor: move; user-select: none; flex-shrink: 0;
            touch-action: none;
        }
        .farm-header-title {
            color: #4ade80; font-weight: 700; font-size: 17px; letter-spacing: 1px;
            display: flex; align-items: center; gap: 8px; text-shadow: 0 0 8px rgba(34,197,94,0.3);
        }
        .farm-header-title .farm-title-icon { font-size: 20px; }

        .farm-body {
            flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px;
        }
        .farm-body::-webkit-scrollbar { width: 5px; }
        .farm-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        .farm-body::-webkit-scrollbar-thumb { background: rgba(34,197,94,0.3); border-radius: 3px; }

        .farm-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 14px; background: rgba(34, 197, 94, 0.05);
            border-top: 1px solid rgba(34,197,94,0.15); flex-shrink: 0; position: relative;
            cursor: move; user-select: none; touch-action: none;
        }
        .farm-resizer {
            position: absolute; right: 0; bottom: 0; width: 20px; height: 20px;
            cursor: nwse-resize; opacity: 0.4; touch-action: none;
            background: linear-gradient(135deg, transparent 50%, rgba(34,197,94,0.4) 50%);
            border-bottom-right-radius: 12px;
        }

        .farm-btn {
            padding: 5px 13px; border-radius: 6px; cursor: pointer;
            border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.1);
            color: #4ade80; font-size: 13px; font-weight: 600; transition: all 0.2s;
        }
        .farm-btn:hover { background: rgba(34,197,94,0.2); border-color: rgba(34,197,94,0.5); }
        .farm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .farm-btn.danger { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); color: #f87171; }
        .farm-btn.danger:hover { background: rgba(239,68,68,0.2); }
        .farm-btn.warn { border-color: rgba(249,115,22,0.3); background: rgba(249,115,22,0.08); color: #fb923c; }
        .farm-btn.warn:hover { background: rgba(249,115,22,0.2); }

        /* ===== 庇护所选择 ===== */
        .farm-shelter-bar {
            display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
            padding: 8px 12px; background: rgba(0,0,0,0.25); border-radius: 8px;
            border: 1px solid rgba(34,197,94,0.15);
        }
        .farm-shelter-bar .shelter-label { color: #71717a; font-size: 13px; white-space: nowrap; }
        .farm-shelter-select {
            flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(34,197,94,0.25);
            border-radius: 6px; padding: 6px 8px; color: #4ade80; font-size: 14px;
            font-family: inherit; outline: none; cursor: pointer;
        }
        .farm-shelter-select:focus { border-color: rgba(34,197,94,0.5); }
        .farm-shelter-select option { background: #18181f; color: #d4d4d8; }

        .farm-no-shelter {
            text-align: center; padding: 40px 20px; color: #71717a;
        }
        .farm-no-shelter .no-shelter-icon { font-size: 48px; opacity: 0.3; margin-bottom: 12px; }
        .farm-no-shelter .no-shelter-text { font-size: 15px; line-height: 1.8; }

        /* ===== 事件警报条 ===== */
        .farm-event-bar {
            display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
            padding: 10px 12px; background: rgba(249,115,22,0.1); border-radius: 8px;
            border: 1px solid rgba(249,115,22,0.3); animation: farm-event-flash 3s ease-in-out infinite;
        }
        @keyframes farm-event-flash {
            0%, 100% { border-color: rgba(249,115,22,0.3); }
            50% { border-color: rgba(249,115,22,0.6); }
        }
        .farm-event-bar .event-icon { font-size: 20px; }
        .farm-event-bar .event-info { flex: 1; }
        .farm-event-bar .event-title { font-size: 14px; font-weight: 600; color: #fb923c; }
        .farm-event-bar .event-desc { font-size: 12px; color: #a1a1aa; margin-top: 2px; }

        /* ===== 道具工具栏 ===== */
        .farm-item-bar {
            display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;
            padding: 8px 10px; background: rgba(0,0,0,0.2); border-radius: 8px;
            border: 1px solid rgba(34,197,94,0.12);
        }
        .farm-item-bar-title { width: 100%; font-size: 12px; color: #71717a; margin-bottom: 4px; letter-spacing: 1px; }
        .farm-item {
            display: flex; align-items: center; gap: 5px; padding: 6px 10px;
            background: rgba(34,197,94,0.06); border: 1.5px solid rgba(34,197,94,0.2);
            border-radius: 8px; cursor: grab; transition: all 0.2s; user-select: none;
            position: relative;
        }
        .farm-item:hover { background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.4); }
        .farm-item:active { cursor: grabbing; }
        .farm-item.selected {
            border-color: #4ade80; background: rgba(34,197,94,0.2);
            box-shadow: 0 0 12px rgba(34,197,94,0.3);
        }
        .farm-item.empty { opacity: 0.35; cursor: not-allowed; }
        .farm-item-icon { font-size: 20px; }
        .farm-item-name { font-size: 12px; color: #a1a1aa; }
        .farm-item-count {
            font-size: 11px; color: #4ade80; font-weight: 700; font-family: 'Consolas', monospace;
            background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 4px; min-width: 18px; text-align: center;
        }
        .farm-item-tip {
            display: none; position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.9); color: #d4d4d8; font-size: 11px; padding: 4px 8px;
            border-radius: 4px; white-space: nowrap; pointer-events: none; z-index: 10;
        }
        .farm-item:hover .farm-item-tip { display: block; }

        /* ===== 农田网格 ===== */
        .farm-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;
        }
        .farm-plot {
            border-radius: 10px; cursor: pointer; position: relative;
            display: flex; flex-direction: column; align-items: center;
            padding: 8px 6px 10px;
            transition: all 0.25s; overflow: hidden; border: 1.5px solid rgba(34,197,94,0.18);
            background: linear-gradient(160deg, rgba(34,197,94,0.05), rgba(0,0,0,0.3));
            min-height: 110px;
        }
        .farm-plot:hover {
            border-color: rgba(34,197,94,0.45);
            box-shadow: 0 0 14px rgba(34,197,94,0.12);
            transform: translateY(-2px);
        }
        .farm-plot.empty {
            border-style: dashed; background: rgba(0,0,0,0.15);
        }
        .farm-plot.empty:hover { background: rgba(34,197,94,0.06); }
        .farm-plot.growing { border-color: rgba(34,197,94,0.25); }
        .farm-plot.mature {
            border-color: rgba(250,204,21,0.35);
            background: linear-gradient(160deg, rgba(250,204,21,0.03), rgba(0,0,0,0.2));
        }
        .farm-plot.mature .plot-name { color: #fbbf24; }
        .farm-plot.mature .plot-stage { color: #fbbf24; opacity: 1; }
        .farm-plot.ready {
            border-color: rgba(250,204,21,0.5);
            background: linear-gradient(160deg, rgba(250,204,21,0.06), rgba(0,0,0,0.2));
            animation: farm-ready-pulse 2s ease-in-out infinite;
        }
        .farm-plot.ready .plot-name { color: #facc15; font-weight: 700; }
        .farm-plot.ready .plot-stage { color: #facc15; font-weight: 700; opacity: 1; }
        @keyframes farm-ready-pulse {
            0%, 100% { box-shadow: 0 0 8px rgba(250,204,21,0.1); }
            50% { box-shadow: 0 0 16px rgba(250,204,21,0.25); }
        }
        .farm-plot.has-event {
            border-color: rgba(249,115,22,0.6);
            animation: farm-plot-event 2s ease-in-out infinite;
        }
        @keyframes farm-plot-event {
            0%, 100% { box-shadow: 0 0 8px rgba(249,115,22,0.15); }
            50% { box-shadow: 0 0 16px rgba(249,115,22,0.4); }
        }
        .farm-plot.has-event.ready {
            border-color: rgba(249,115,22,0.6);
            animation: farm-plot-event 2s ease-in-out infinite;
        }
        /* 拖拽悬停高亮 */
        .farm-plot.drag-over {
            border-color: #4ade80 !important;
            box-shadow: 0 0 20px rgba(34,197,94,0.4) !important;
        }

        .plot-icon { font-size: 28px; line-height: 1; margin-bottom: 2px; }
        .plot-name { font-size: 12px; color: #a1a1aa; letter-spacing: 0.3px; font-weight: 600; }
        .plot-stage { font-size: 11px; color: #4ade80; opacity: 0.9; margin-top: 1px; }
        .plot-progress {
            width: 100%; height: 4px; margin-top: 3px;
            background: rgba(0,0,0,0.3); border-radius: 2px; overflow: hidden;
        }
        .plot-progress-fill {
            height: 100%; background: linear-gradient(90deg, #166534, #22c55e);
            transition: width 0.8s ease; border-radius: 2px;
        }
        .farm-plot.ready .plot-progress-fill { background: linear-gradient(90deg, #a16207, #facc15); }
        .farm-plot.has-event .plot-progress-fill { background: linear-gradient(90deg, #9a3412, #f97316); }

        .plot-event-badge {
            position: absolute; top: 3px; right: 3px; font-size: 14px;
            background: rgba(0,0,0,0.6); border-radius: 50%; width: 22px; height: 22px;
            display: flex; align-items: center; justify-content: center;
            animation: farm-badge-bounce 1s ease-in-out infinite;
        }
        @keyframes farm-badge-bounce {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.2); }
        }

        .plot-empty-icon { font-size: 28px; opacity: 0.25; }
        .plot-empty-text { font-size: 11px; color: #52525b; margin-top: 3px; }

        /* ===== 作物选择浮层 ===== */
        .crop-picker-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000001;
            display: flex; align-items: center; justify-content: center; backdrop-filter: blur(3px);
        }
        .crop-picker {
            background: rgba(18, 22, 16, 0.98); border: 1px solid rgba(34,197,94,0.35);
            border-radius: 12px; padding: 10px; z-index: 1000002;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5); backdrop-filter: blur(10px);
            width: min(340px, 90vw); max-height: 70vh; display: flex; flex-direction: column;
        }
        .crop-picker-title {
            font-size: 13px; color: #71717a; padding: 4px 6px 8px;
            border-bottom: 1px solid rgba(34,197,94,0.12); margin-bottom: 4px; letter-spacing: 1px; flex-shrink: 0;
        }
        .crop-picker-list {
            overflow-y: auto; flex: 1; min-height: 0;
        }
        .crop-picker-list::-webkit-scrollbar { width: 4px; }
        .crop-picker-list::-webkit-scrollbar-thumb { background: rgba(34,197,94,0.3); border-radius: 2px; }
        .crop-option {
            display: flex; align-items: center; gap: 10px; padding: 7px 6px;
            border-radius: 6px; cursor: pointer; transition: background 0.15s;
        }
        .crop-option:hover { background: rgba(34,197,94,0.12); }
        .crop-option-icon { font-size: 20px; }
        .crop-option-info { flex: 1; min-width: 0; }
        .crop-option-name { font-size: 14px; color: #d4d4d8; font-weight: 600; }
        .crop-option-meta { font-size: 11px; color: #71717a; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .crop-option-time { font-size: 12px; color: #4ade80; opacity: 0.7; white-space: nowrap; }

        /* ===== 作物属性条 ===== */
        .plot-attrs {
            display: flex; gap: 4px;
            width: 100%; margin: 5px 0 2px; padding: 0 2px;
        }
        .plot-attr-row {
            flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .plot-attr-icon {
            font-size: 11px; line-height: 1;
        }
        .plot-attr-bar {
            width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden;
        }
        .plot-attr-fill {
            height: 100%; border-radius: 3px; transition: width 0.5s;
        }
        .plot-attr-fill.water { background: linear-gradient(90deg, #1d4ed8, #3b82f6); }
        .plot-attr-fill.fert { background: linear-gradient(90deg, #7c3aed, #a855f7); }
        .plot-attr-fill.health { background: linear-gradient(90deg, #15803d, #22c55e); }
        .plot-attr-fill.water.low { background: linear-gradient(90deg, #991b1b, #ef4444); }
        .plot-attr-fill.fert.low { background: linear-gradient(90deg, #991b1b, #ef4444); }
        .plot-attr-fill.health.low { background: linear-gradient(90deg, #991b1b, #ef4444); }
        .plot-attr-val {
            font-size: 11px; color: #d4d4d8; font-family: 'Consolas', monospace; font-weight: 600; line-height: 1;
        }
        .plot-attr-val.low { color: #ef4444; }

        /* ===== 作物详情浮层 ===== */
        .crop-detail-popup {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000002;
            display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
            touch-action: auto; -webkit-tap-highlight-color: transparent;
        }
        .crop-detail-card {
            background: rgba(18, 22, 16, 0.98); border: 1px solid rgba(34,197,94,0.3);
            border-radius: 14px; padding: 20px; min-width: 280px; max-width: 340px;
            box-shadow: 0 0 24px rgba(34,197,94,0.1);
        }
        .crop-detail-header {
            display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
            padding-bottom: 12px; border-bottom: 1px solid rgba(34,197,94,0.12);
        }
        .crop-detail-icon { font-size: 36px; }
        .crop-detail-name { font-size: 18px; font-weight: 700; color: #4ade80; }
        .crop-detail-stage { font-size: 13px; color: #a1a1aa; margin-top: 2px; }
        .crop-detail-attrs { display: flex; flex-direction: column; gap: 8px; }
        .crop-detail-attr {
            display: flex; align-items: center; gap: 8px;
        }
        .crop-detail-attr-icon { font-size: 14px; width: 20px; text-align: center; }
        .crop-detail-attr-bar {
            flex: 1; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;
        }
        .crop-detail-attr-fill {
            height: 100%; border-radius: 4px; transition: width 0.5s;
        }
        .crop-detail-attr-fill.water { background: linear-gradient(90deg, #1d4ed8, #3b82f6); }
        .crop-detail-attr-fill.fert { background: linear-gradient(90deg, #7c3aed, #a855f7); }
        .crop-detail-attr-fill.health { background: linear-gradient(90deg, #15803d, #22c55e); }
        .crop-detail-attr-fill.low { background: linear-gradient(90deg, #991b1b, #ef4444) !important; }
        .crop-detail-attr-val {
            font-size: 12px; color: #a1a1aa; font-family: 'Consolas', monospace; min-width: 30px; text-align: right;
        }
        .crop-detail-info {
            margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(34,197,94,0.08);
            font-size: 13px; color: #71717a; line-height: 1.8;
        }
        .crop-detail-close {
            margin-top: 14px; display: flex; justify-content: center;
        }

        /* ===== 收获浮层 ===== */
        .harvest-popup {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000002;
            display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
        }
        .harvest-card {
            background: rgba(18, 22, 16, 0.98); border: 1px solid rgba(250,204,21,0.35);
            border-radius: 14px; padding: 24px; min-width: 280px; text-align: center;
            box-shadow: 0 0 30px rgba(250,204,21,0.15);
        }
        .harvest-icon { font-size: 48px; margin-bottom: 8px; }
        .harvest-title { font-size: 18px; font-weight: 700; color: #facc15; margin-bottom: 4px; }
        .harvest-desc { font-size: 14px; color: #71717a; margin-bottom: 16px; }
        .harvest-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
        .harvest-btn {
            padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 14px;
            font-weight: 600; border: none; transition: all 0.2s;
        }
        .harvest-btn.store {
            background: linear-gradient(135deg, #166534, #22c55e); color: #fff;
        }
        .harvest-btn.store:hover { box-shadow: 0 0 12px rgba(34,197,94,0.4); }
        .harvest-btn.cancel {
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #71717a;
        }
        .harvest-btn.resolve {
            background: linear-gradient(135deg, #9a3412, #f97316); color: #fff;
        }
        .harvest-btn.resolve:hover { box-shadow: 0 0 12px rgba(249,115,22,0.4); }

        .harvest-yield-penalty { font-size: 13px; color: #f87171; margin-top: 6px; }
        .harvest-item-hint { font-size: 13px; color: #a1a1aa; margin-top: 6px; }

        /* ===== 日志 ===== */
        .farm-log {
            margin-top: 8px; max-height: 120px; overflow-y: auto;
            background: rgba(0,0,0,0.2); border-radius: 6px; padding: 8px 10px;
            border: 1px solid rgba(34,197,94,0.08);
        }
        .farm-log-title { font-size: 12px; color: #71717a; letter-spacing: 1px; margin-bottom: 6px; }
        .farm-log-entry { font-size: 13px; color: #52525b; padding: 2px 0; display: flex; gap: 6px; }
        .farm-log-entry .log-time { color: #3f6212; font-family: 'Consolas', monospace; font-size: 11px; white-space: nowrap; }
        .farm-log-entry .log-text { color: #a1a1aa; }
        .farm-log-entry .log-text.stolen { color: #a855f7; }

        /* ===== 统计栏 ===== */
        .farm-stats { display: flex; gap: 10px; margin-bottom: 12px; }
        .farm-stat {
            flex: 1; text-align: center; padding: 7px 8px;
            background: rgba(0,0,0,0.2); border-radius: 6px;
            border: 1px solid rgba(34,197,94,0.08);
        }
        .farm-stat-val { font-size: 22px; font-weight: 700; color: #4ade80; font-family: 'Consolas', monospace; text-shadow: 0 0 6px rgba(34,197,94,0.25); }
        .farm-stat-label { font-size: 11px; color: #52525b; letter-spacing: 0.5px; margin-top: 2px; }

        /* ===== Toast ===== */
        .farm-toast {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: rgba(18, 22, 16, 0.95); border: 1px solid rgba(34,197,94,0.3);
            border-radius: 8px; padding: 10px 20px; color: #4ade80;
            font-size: 15px; font-weight: 600; z-index: 1000003;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4); backdrop-filter: blur(8px);
            animation: farm-toast-in 0.3s ease, farm-toast-out 0.3s ease 2s forwards;
        }
        .farm-toast.event-toast { border-color: rgba(249,115,22,0.4); color: #fb923c; }
        @keyframes farm-toast-in { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } }
        @keyframes farm-toast-out { to { opacity: 0; transform: translateX(-50%) translateY(-10px); } }

        /* ===== 移动端适配 ===== */
        @media (max-width: 768px) {
            .farm-main-panel {
                width: clamp(300px, 92vw, 420px) !important;
                height: clamp(360px, 72vh, 600px) !important;
                max-width: 95vw !important; max-height: 88vh !important;
                font-size: 14px; resize: none !important;
            }
            .farm-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }
            .farm-header { height: 42px; padding: 0 10px; cursor: default; }
            .farm-header-title { font-size: 15px; }
            .farm-body { padding: 10px; }
            .plot-icon { font-size: 26px; }
            .plot-name { font-size: 11px; }
            .plot-stage { font-size: 10px; }
            .farm-btn { padding: 5px 10px; font-size: 12px; }
            #farm-bubble { width: 46px; height: 46px; font-size: 22px; }
            .harvest-card { min-width: 240px; padding: 18px; }
            .farm-stats { gap: 6px; }
            .farm-stat-val { font-size: 18px; }
            .farm-stat-label { font-size: 10px; }
            .farm-item { padding: 5px 8px; }
            .farm-item-icon { font-size: 18px; }
            .farm-item-name { font-size: 11px; }
            .farm-item-count { font-size: 10px; }
            .farm-shelter-select { font-size: 13px; }
            .farm-event-bar .event-title { font-size: 13px; }
            .farm-event-bar .event-desc { font-size: 11px; }
            .crop-picker { width: min(300px, 88vw); max-height: 60vh; }
        }
        @media (max-width: 360px) {
            .farm-main-panel {
                width: 94vw !important; height: clamp(320px, 75vh, 520px) !important;
                font-size: 13px;
            }
            .farm-grid { grid-template-columns: repeat(2, 1fr); gap: 5px; }
            .plot-icon { font-size: 22px; }
            .plot-name { font-size: 10px; }
            .plot-attr-val { font-size: 10px; }
            .crop-picker { width: 92vw; }
        }

        /* ===== 手动亮色模式 ===== */
        .farm-main-panel.farm-force-light {
            background: rgba(245, 248, 242, 0.97); border-color: rgba(22, 101, 52, 0.2);
            box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 20px rgba(34,197,94,0.06); color: #1a2e12;
        }
        .farm-main-panel.farm-force-light::before {
            background: linear-gradient(90deg, #166534, #4ade80, #86efac, #4ade80, #166534);
        }
        .farm-main-panel.farm-force-light .farm-header {
            background: rgba(34, 197, 94, 0.08); border-bottom-color: rgba(22, 101, 52, 0.15);
        }
        .farm-main-panel.farm-force-light .farm-header-title { color: #15803d; }
        .farm-main-panel.farm-force-light .farm-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.06); }
        .farm-main-panel.farm-force-light .farm-body::-webkit-scrollbar-thumb { background: rgba(34,197,94,0.25); }
        .farm-main-panel.farm-force-light .farm-footer {
            background: rgba(34, 197, 94, 0.04); border-top-color: rgba(22, 101, 52, 0.12);
        }
        .farm-main-panel.farm-force-light .farm-btn {
            border-color: rgba(22,101,52,0.25); background: rgba(34,197,94,0.06); color: #15803d;
        }
        .farm-main-panel.farm-force-light .farm-btn:hover { background: rgba(34,197,94,0.12); border-color: rgba(22,101,52,0.4); }
        .farm-main-panel.farm-force-light .farm-btn.danger { border-color: rgba(185,28,28,0.25); background: rgba(239,68,68,0.06); color: #b91c1c; }
        .farm-main-panel.farm-force-light .farm-btn.warn { border-color: rgba(154,52,18,0.25); background: rgba(249,115,22,0.06); color: #9a3412; }
        .farm-main-panel.farm-force-light .farm-shelter-bar {
            background: rgba(0,0,0,0.04); border-color: rgba(22,101,52,0.12);
        }
        .farm-main-panel.farm-force-light .farm-shelter-bar .shelter-label { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-shelter-select {
            background: rgba(255,255,255,0.8); border-color: rgba(22,101,52,0.2); color: #15803d;
        }
        .farm-main-panel.farm-force-light .farm-shelter-select option { background: #fff; color: #1a2e12; }
        .farm-main-panel.farm-force-light .farm-no-shelter { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-plot {
            border-color: rgba(22,101,52,0.12);
            background: linear-gradient(160deg, rgba(34,197,94,0.03), rgba(255,255,255,0.5));
        }
        .farm-main-panel.farm-force-light .farm-plot:hover { border-color: rgba(34,197,94,0.35); }
        .farm-main-panel.farm-force-light .farm-plot.empty { background: rgba(0,0,0,0.03); }
        .farm-main-panel.farm-force-light .farm-plot.ready {
            border-color: rgba(202,138,4,0.4);
            background: linear-gradient(160deg, rgba(250,204,21,0.05), rgba(255,255,255,0.5));
        }
        .farm-main-panel.farm-force-light .farm-plot.mature .plot-name,
        .farm-main-panel.farm-force-light .farm-plot.ready .plot-name { color: #a16207; }
        .farm-main-panel.farm-force-light .farm-plot.mature .plot-stage,
        .farm-main-panel.farm-force-light .farm-plot.ready .plot-stage { color: #a16207; font-weight: 700; }
        .farm-main-panel.farm-force-light .farm-plot.has-event { border-color: rgba(154,52,18,0.5); }
        .farm-main-panel.farm-force-light .farm-plot.drag-over {
            border-color: #15803d !important; background: rgba(34,197,94,0.1) !important;
        }
        .farm-main-panel.farm-force-light .plot-name { color: #6b7280; }
        .farm-main-panel.farm-force-light .plot-stage { color: #15803d; }
        .farm-main-panel.farm-force-light .plot-empty-text { color: #9ca3af; }
        .farm-main-panel.farm-force-light .farm-stat { background: rgba(0,0,0,0.04); border-color: rgba(22,101,52,0.08); }
        .farm-main-panel.farm-force-light .farm-stat-val { color: #15803d; }
        .farm-main-panel.farm-force-light .farm-stat-label { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-log { background: rgba(0,0,0,0.04); border-color: rgba(22,101,52,0.08); }
        .farm-main-panel.farm-force-light .farm-log-title { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-log-entry .log-time { color: #15803d; }
        .farm-main-panel.farm-force-light .farm-log-entry .log-text { color: #374151; }
        .farm-main-panel.farm-force-light .farm-event-bar { background: rgba(249,115,22,0.06); border-color: rgba(154,52,18,0.25); }
        .farm-main-panel.farm-force-light .farm-event-bar .event-title { color: #9a3412; }
        .farm-main-panel.farm-force-light .farm-event-bar .event-desc { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-item-bar { background: rgba(0,0,0,0.04); border-color: rgba(22,101,52,0.1); }
        .farm-main-panel.farm-force-light .farm-item { background: rgba(34,197,94,0.04); border-color: rgba(22,101,52,0.15); }
        .farm-main-panel.farm-force-light .farm-item:hover { background: rgba(34,197,94,0.1); }
        .farm-main-panel.farm-force-light .farm-item.selected { background: rgba(34,197,94,0.15); border-color: #15803d; }
        .farm-main-panel.farm-force-light .farm-item-name { color: #6b7280; }
        .farm-main-panel.farm-force-light .farm-item-count { color: #15803d; background: rgba(0,0,0,0.06); }
        .farm-main-panel.farm-force-light .farm-resizer {
            background: linear-gradient(135deg, transparent 50%, rgba(34,197,94,0.3) 50%);
        }

        .farm-toast-light {
            background: rgba(245, 248, 242, 0.96) !important;
            border-color: rgba(22,101,52,0.25) !important;
            color: #15803d !important; box-shadow: 0 4px 16px rgba(0,0,0,0.12) !important;
        }
        .farm-toast-light.event-toast { border-color: rgba(154,52,18,0.25) !important; color: #9a3412 !important; }

        .farm-main-panel.farm-force-light .plot-attr-bar { background: rgba(0,0,0,0.08); }
        .farm-main-panel.farm-force-light .plot-attr-val { color: #374151; }
        .farm-main-panel.farm-force-light .plot-attr-val.low { color: #dc2626; }
        .farm-main-panel.farm-force-light .crop-detail-attr-val { color: #374151; }

        .crop-detail-popup.farm-detail-light .crop-detail-card {
            background: rgba(245, 248, 242, 0.98); border-color: rgba(22,101,52,0.2);
        }
        .crop-detail-popup.farm-detail-light .crop-detail-name { color: #15803d; }
        .crop-detail-popup.farm-detail-light .crop-detail-stage { color: #6b7280; }
        .crop-detail-popup.farm-detail-light .crop-detail-attr-bar { background: rgba(0,0,0,0.08); }
        .crop-detail-popup.farm-detail-light .crop-detail-attr-val { color: #374151; }
        .crop-detail-popup.farm-detail-light .crop-detail-info { color: #6b7280; }
        .crop-detail-popup.farm-detail-light .harvest-btn.cancel {
            background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.1); color: #6b7280;
        }

        .harvest-popup.farm-harvest-light .harvest-card {
            background: rgba(245, 248, 242, 0.98); border-color: rgba(202,138,4,0.3);
        }
        .harvest-popup.farm-harvest-light .harvest-title { color: #a16207; }
        .harvest-popup.farm-harvest-light .harvest-desc { color: #6b7280; }
        .harvest-popup.farm-harvest-light .harvest-btn.store { background: linear-gradient(135deg, #166534, #22c55e); color: #fff; }
        .harvest-popup.farm-harvest-light .harvest-btn.cancel { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.1); color: #6b7280; }
        .harvest-popup.farm-harvest-light .harvest-btn.resolve { background: linear-gradient(135deg, #9a3412, #f97316); color: #fff; }

        .farm-picker-light {
            background: rgba(245, 248, 242, 0.98) !important;
            border-color: rgba(22,101,52,0.2) !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important;
        }
        .farm-picker-light .crop-picker-title { color: #6b7280; }
        .farm-picker-light .crop-option-name { color: #1a2e12; }
        .farm-picker-light .crop-option-meta { color: #6b7280; }
        .farm-picker-light .crop-option-time { color: #15803d; }
    </style>`;

    // ==================== 工具函数 ====================
    function timeAgo(ts) {
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return sec + '秒前';
        const min = Math.floor(sec / 60);
        if (min < 60) return min + '分钟前';
        const hr = Math.floor(min / 60);
        return hr + '小时前';
    }
    function formatMin(m) {
        if (m < 1) return Math.round(m * 60) + '秒';
        if (m < 60) return m.toFixed(1) + '分钟';
        return (m / 60).toFixed(1) + '小时';
    }
    function showToast(msg, isEvent = false) {
        const t = p.document.createElement('div');
        t.className = 'farm-toast' + (isEvent ? ' event-toast' : '');
        if (panel.classList.contains('farm-force-light')) t.classList.add('farm-toast-light');
        t.textContent = msg;
        p.document.body.appendChild(t);
        setTimeout(() => t.remove(), 2500);
    }

    function getActiveEventCount() {
        return Object.values(farmState.events).filter(e => !e.resolved).length;
    }

    // ==================== 初始化检查：移除旧 DOM ====================
    /**
     * 如果页面上已存在旧的农场 UI（脚本重启但 DOM 未清理），先移除
     * 这解决了"酒馆助手关闭后图标不消失"的问题
     */
    await loadConfig();
    await loadState(farmConfig.selectedShelter || '');
    const p = window.parent || window;
    const existingPanel = p.document.getElementById('farm-panel');
    const existingBubble = p.document.getElementById('farm-bubble');
    if (existingPanel || existingBubble) {
        console.warn('[小农场] 检测到残留 DOM，正在清理...');
        if (existingPanel) existingPanel.remove();
        if (existingBubble) existingBubble.remove();
        p.document.querySelectorAll('.crop-picker-overlay, .crop-detail-popup, .harvest-popup, .farm-toast').forEach(el => el.remove());
    }

    // ==================== HTML ====================
    const HTML = `
    <div id="farm-panel" class="farm-main-panel"
         style="display:${farmConfig.isMinimized ? 'none' : 'flex'};
                left:50%; top:50%;
                width:${farmConfig.panelWidth}; height:${farmConfig.panelHeight};
                transform: translate(-50%, -50%);">
        <div class="farm-header" id="farm-drag-handle">
            <div class="farm-header-title">
                <span class="farm-title-icon">🌻</span> 小农场
            </div>
            <div style="display:flex;gap:4px;">
                <button class="farm-btn" id="farm-theme-toggle" title="切换亮色/暗色模式">🌑</button>
                <button class="farm-btn" id="farm-refresh" title="刷新庇护所">🔄</button>
            </div>
        </div>
        <div class="farm-body" id="farm-body"></div>
        <div class="farm-footer" id="farm-footer">
            <span style="font-size:11px;color:#52525b;">🌱 末世田园</span>
            <div style="display:flex;gap:6px;">
                <button class="farm-btn danger" id="farm-clear-plots">清除农田</button>
                <button class="farm-btn warn" id="farm-disable" title="停用农场（数据保留）">🛑 停用</button>
            </div>
            <div class="farm-resizer" id="farm-resizer"></div>
        </div>
    </div>
    <div id="farm-bubble" style="top:${farmConfig.bubbleTop}; left:${farmConfig.bubbleLeft || '10px'};">🌻</div>`;

    p.document.body.insertAdjacentHTML('beforeend', CSS + HTML);

    const panel = p.document.getElementById('farm-panel');
    const bubble = p.document.getElementById('farm-bubble');
    const body = p.document.getElementById('farm-body');

    // ==================== 渲染 ====================
    let currentShelters = {};
    let selectedShelter = farmConfig.selectedShelter || '';
    let tickInterval = null;
    let selectedItemKey = null; // 移动端：已选中的道具

    async function refreshShelters(forceCold = true) {
        currentShelters = await getShelters(!forceCold);
        const shelterNames = Object.keys(currentShelters);
        if (!selectedShelter || !shelterNames.includes(selectedShelter)) {
            /* 庇护所列表变化，保存旧状态并加载新庇护所 */
            const oldShelter = selectedShelter;
            selectedShelter = shelterNames[0] || '';
            if (oldShelter && oldShelter !== selectedShelter) {
                await saveState(oldShelter);
                await loadState(selectedShelter);
            }
        }
        renderPanel();
    }

    function renderPanel() {
        const shelterNames = Object.keys(currentShelters);
        const activeEvents = Object.entries(farmState.events).filter(([, e]) => !e.resolved);

        if (activeEvents.length > 0) {
            bubble.classList.add('has-event');
        } else {
            bubble.classList.remove('has-event');
        }

        if (shelterNames.length === 0) {
            body.innerHTML = `
                <div class="farm-no-shelter">
                    <div class="no-shelter-icon">🏚️</div>
                    <div class="no-shelter-text">
                        没有庇护所，无法启用农场<br>
                        <span style="font-size:12px;color:#3f3f46;">获得庇护所后点击 🔄 刷新</span>
                    </div>
                </div>`;
            return;
        }

        if (!selectedShelter || !shelterNames.includes(selectedShelter)) {
            selectedShelter = shelterNames[0];
        }

        const planted = farmState.plots.filter(p => p !== null).length;
        const ready = farmState.plots.filter((p, i) => p && getPlotStage(p, i)?.stageIdx === 4).length;
        const totalHarvested = farmState.harvestLog.length;
        const eventCount = activeEvents.length;

        let html = `
            <div class="farm-shelter-bar">
                <span class="shelter-label">🏠 庇护所</span>
                <select class="farm-shelter-select" id="farm-shelter-sel">
                    ${shelterNames.map(n => `<option value="${n}" ${n === selectedShelter ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
            </div>
            <div class="farm-stats">
                <div class="farm-stat"><div class="farm-stat-val">${planted}</div><div class="farm-stat-label">种植中</div></div>
                <div class="farm-stat"><div class="farm-stat-val" style="color:#facc15">${ready}</div><div class="farm-stat-label">可收获</div></div>
                <div class="farm-stat"><div class="farm-stat-val">${totalHarvested}</div><div class="farm-stat-label">总收获</div></div>
                ${eventCount > 0 ? `<div class="farm-stat"><div class="farm-stat-val" style="color:#f97316">${eventCount}</div><div class="farm-stat-label">⚠ 警报</div></div>` : ''}
            </div>
            ${ready > 0 ? `<button class="farm-btn warn" id="farm-harvest-all" style="width:100%;margin-bottom:10px;font-size:14px;padding:7px 0;">🌾 一键收获 (${ready}块田地)</button>` : ''}`;

        // 事件警报条
        if (activeEvents.length > 0) {
            const latestEvent = activeEvents[activeEvents.length - 1];
            const evtIdx = latestEvent[0];
            const evt = latestEvent[1];
            const et = EVENT_TYPES[evt.type];
            const neededItem = Object.entries(ITEMS).find(([, i]) => i.resolves === evt.type);
            html += `
                <div class="farm-event-bar">
                    <span class="event-icon">${et.icon}</span>
                    <div class="event-info">
                        <div class="event-title">${et.name}！田地${parseInt(evtIdx) + 1}的${farmState.plots[evtIdx]?.crop || '作物'}需要${et.actionName}</div>
                        <div class="event-desc">${et.desc} · 拖拽${neededItem ? neededItem[1].icon + neededItem[1].name : ''}到田地解除</div>
                    </div>
                </div>`;
        }

        // 道具工具栏
        html += `<div class="farm-item-bar"><div class="farm-item-bar-title">🧰 道具（拖拽到田地使用 · 每2分钟+1）</div>`;
        for (const [key, item] of Object.entries(ITEMS)) {
            const count = farmState.items[key] || 0;
            const isEmpty = count <= 0;
            const isSelected = selectedItemKey === key;
            html += `
                <div class="farm-item${isEmpty ? ' empty' : ''}${isSelected ? ' selected' : ''}"
                     draggable="${isEmpty ? 'false' : 'true'}" data-item="${key}">
                    <span class="farm-item-icon">${item.icon}</span>
                    <span class="farm-item-name">${item.name}</span>
                    <span class="farm-item-count">${count}</span>
                    <span class="farm-item-tip">${item.desc} → ${EVENT_TYPES[item.resolves]?.name || ''}</span>
                </div>`;
        }
        html += `</div>`;

        html += `<div class="farm-grid" id="farm-grid">`;

        for (let i = 0; i < PLOT_COUNT; i++) {
            const plot = farmState.plots[i];
            if (!plot) {
                html += `
                    <div class="farm-plot empty" data-idx="${i}">
                        <div class="plot-empty-icon">➕</div>
                        <div class="plot-empty-text">种植</div>
                    </div>`;
            } else {
                const info = getPlotStage(plot, i);
                const crop = CROPS[plot.crop];
                const isReady = info.stageIdx === 4;
                const isMature = info.stageIdx === 3;
                const evt = farmState.events[i];
                const hasEvent = evt && !evt.resolved;
                const cls = [hasEvent ? 'has-event' : '', isReady ? 'ready' : isMature ? 'mature' : 'growing'].filter(Boolean).join(' ');
                const icon = (isMature || isReady) ? crop.icon : info.stage.icon;
                const pctText = Math.round(info.progress * 100);
                const evtBadge = hasEvent ? `<div class="plot-event-badge">${EVENT_TYPES[evt.type].icon}</div>` : '';
                const stageName = hasEvent ? EVENT_TYPES[evt.type].name : isReady ? '可收获!' : info.stage.name;
                const water = plot.water ?? 80;
                const fertilizer = plot.fertilizer ?? 75;
                const health = plot.health ?? 100;
                html += `
                    <div class="farm-plot ${cls}" data-idx="${i}" title="${isReady ? '点击收获' : info.stage.name + ' ' + pctText + '%'}">
                        ${evtBadge}
                        <div class="plot-icon">${icon}</div>
                        <div class="plot-name">${plot.crop}</div>
                        <div class="plot-stage">${stageName}</div>
                        ${!isReady ? `<div class="plot-attrs">
                            <div class="plot-attr-row"><span class="plot-attr-icon">💧</span><div class="plot-attr-bar"><div class="plot-attr-fill water${water < 30 ? ' low' : ''}" style="width:${water}%"></div></div><span class="plot-attr-val${water < 30 ? ' low' : ''}">${Math.round(water)}</span></div>
                            <div class="plot-attr-row"><span class="plot-attr-icon">🧪</span><div class="plot-attr-bar"><div class="plot-attr-fill fert${fertilizer < 30 ? ' low' : ''}" style="width:${fertilizer}%"></div></div><span class="plot-attr-val${fertilizer < 30 ? ' low' : ''}">${Math.round(fertilizer)}</span></div>
                            <div class="plot-attr-row"><span class="plot-attr-icon">❤️</span><div class="plot-attr-bar"><div class="plot-attr-fill health${health < 30 ? ' low' : ''}" style="width:${health}%"></div></div><span class="plot-attr-val${health < 30 ? ' low' : ''}">${Math.round(health)}</span></div>
                        </div>` : ''}
                        <div class="plot-progress"><div class="plot-progress-fill" style="width:${pctText}%"></div></div>
                    </div>`;
            }
        }
        html += `</div>`;

        // 日志
        const allLogs = [
            ...farmState.harvestLog.map(l => ({ ...l, type: 'harvest' })),
            ...farmState.stolenLog.map(l => ({ ...l, type: 'stolen' })),
        ].sort((a, b) => b.time - a.time);

        if (allLogs.length > 0) {
            html += `<div class="farm-log"><div class="farm-log-title" style="display:flex;justify-content:space-between;align-items:center;">📋 农场记录<button class="farm-btn danger" id="farm-clear-log" style="padding:2px 8px;font-size:11px;">清空</button></div>`;
            allLogs.forEach(log => {
                const isStolen = log.type === 'stolen';
                html += `<div class="farm-log-entry"><span class="log-time">${timeAgo(log.time)}</span><span class="log-text${isStolen ? ' stolen' : ''}">${log.text}</span></div>`;
            });
            html += `</div>`;
        }

        body.innerHTML = html;

        // 绑定庇护所切换
        const sel = p.document.getElementById('farm-shelter-sel');
        if (sel) {
            sel.addEventListener('change', async (e) => {
                const oldShelter = selectedShelter;
                const newShelter = e.target.value;
                if (oldShelter === newShelter) return;
                /* 保存旧庇护所的农场状态 */
                await saveState(oldShelter);
                /* 切换到新庇护所，加载其独立数据 */
                selectedShelter = newShelter;
                saveConfig({ selectedShelter });
                await loadState(newShelter);
                renderPanel();
            });
        }

        // 绑定清空日志
        const clearLogBtn = p.document.getElementById('farm-clear-log');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', async () => {
                farmState.harvestLog = [];
                farmState.stolenLog = [];
                await saveState();
                renderPanel();
                showToast('📋 记录已清空');
            });
        }

        // 绑定一键收获
        const harvestAllBtn = p.document.getElementById('farm-harvest-all');
        if (harvestAllBtn) {
            harvestAllBtn.addEventListener('click', () => harvestAll());
        }
    }

    // ==================== 道具拖拽 & 移动端选择（事件委托模式）====================
    /**
     * 绑定道具拖拽和移动端点击选择
     * 使用事件委托避免重复绑定，支持桌面拖拽和移动端点击两种交互模式
     */
    function bindItemDragDrop() {
        // 道具拖拽开始（桌面端）
        body.addEventListener('dragstart', (e) => {
            const itemEl = e.target.closest('.farm-item:not(.empty)');
            if (!itemEl) return;
            e.dataTransfer.setData('text/plain', itemEl.dataset.item);
            e.dataTransfer.effectAllowed = 'move';
            itemEl.style.opacity = '0.5';
            itemEl._isDragging = true;
        });

        // 道具拖拽结束（桌面端）
        body.addEventListener('dragend', (e) => {
            const itemEl = e.target.closest('.farm-item');
            if (!itemEl) return;
            itemEl.style.opacity = '1';
            itemEl._isDragging = false;
        });

        // 道具点击选择（移动端）
        body.addEventListener('click', (e) => {
            const itemEl = e.target.closest('.farm-item:not(.empty)');
            if (!itemEl || itemEl._isDragging) return;
            e.stopPropagation();
            const key = itemEl.dataset.item;
            if (selectedItemKey === key) {
                selectedItemKey = null; // 取消选择
            } else {
                selectedItemKey = key;
            }
            renderPanel();
        });

        // 田地拖拽悬停高亮
        body.addEventListener('dragover', (e) => {
            const plotEl = e.target.closest('.farm-plot:not(.empty)');
            if (plotEl) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                plotEl.classList.add('drag-over');
            }
        });

        // 田地拖拽离开
        body.addEventListener('dragleave', (e) => {
            const plotEl = e.target.closest('.farm-plot');
            if (plotEl && !plotEl.contains(e.relatedTarget)) {
                plotEl.classList.remove('drag-over');
            }
        });

        // 田地接收道具拖放
        body.addEventListener('drop', (e) => {
            const plotEl = e.target.closest('.farm-plot');
            if (!plotEl) return;
            e.preventDefault();
            plotEl.classList.remove('drag-over');
            const itemKey = e.dataTransfer.getData('text/plain');
            const plotIdx = parseInt(plotEl.dataset.idx);
            if (itemKey && !isNaN(plotIdx)) {
                useItemOnPlot(itemKey, plotIdx);
            }
        });
    }

    // ==================== 田地点击（种植/收获/道具使用）事件委托 ====================
    /**
     * 绑定田地点击事件（事件委托模式）
     * 支持：空地种植、生长中查看详情、成熟收获、移动端道具使用
     */
    function bindPlotClicks() {
        body.addEventListener('click', async (e) => {
            const plotEl = e.target.closest('.farm-plot');
            if (!plotEl) return;

            const idx = parseInt(plotEl.dataset.idx);
            if (isNaN(idx)) return;

            // 移动端：如果已选中道具，使用道具
            if (selectedItemKey) {
                useItemOnPlot(selectedItemKey, idx);
                selectedItemKey = null;
                renderPanel();
                return;
            }

            const plot = farmState.plots[idx];
            if (!plot) {
                // 空地：打开种植选择器
                p._farmPlant(idx);
                return;
            }

            const info = getPlotStage(plot, idx);
            const evt = farmState.events[idx];
            const hasEvent = evt && !evt.resolved;
            const crop = CROPS[plot.crop];

            // 有事件：弹出提示面板（只能用道具解决）
            if (hasEvent) {
                const et = EVENT_TYPES[evt.type];
                const neededItem = Object.entries(ITEMS).find(([, i]) => i.resolves === evt.type);
                const isReady = info.stageIdx === 4;

                const overlay = p.document.createElement('div');
                overlay.className = 'harvest-popup';
                if (panel.classList.contains('farm-force-light')) overlay.classList.add('farm-harvest-light');

                let harvestSection = '';
                if (isReady) {
                    const actualYield = calcYield(plot, idx);
                    const normalYield = crop.yield;
                    const penaltyText = actualYield < normalYield ? `<div class="harvest-yield-penalty">⚠ 因${et.name}减产：${normalYield} → ${actualYield}</div>` : '';
                    harvestSection = `
                        <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">
                            <div class="harvest-title" style="font-size:15px;">同时收获 ${crop.icon}${plot.crop}</div>
                            ${penaltyText}
                        </div>`;
                }

                overlay.innerHTML = `
                    <div class="harvest-card">
                        <div class="harvest-icon">${et.icon}</div>
                        <div class="harvest-title" style="color:${et.color};">${et.name}！</div>
                        <div class="harvest-desc">${et.desc}<br>田地${idx + 1}的${plot.crop}需要${et.actionName}</div>
                        <div class="harvest-item-hint">💡 拖拽 ${neededItem ? neededItem[1].icon + neededItem[1].name : ''} 到田地解除</div>
                        ${harvestSection}
                        <div class="harvest-actions" style="margin-top:16px;">
                            ${isReady ? `<button class="harvest-btn store" id="h-store">📦 收获并存入</button>` : ''}
                            <button class="harvest-btn cancel" id="h-cancel">关闭</button>
                        </div>
                    </div>`;
                p.document.body.appendChild(overlay);

                if (isReady) {
                    const storeBtn = overlay.querySelector('#h-store');
                    if (storeBtn) {
                        storeBtn.addEventListener('click', async () => {
                            const actualYield = calcYield(plot, idx);
                            // 立即更新UI
                            farmState.plots[idx] = null;
                            delete farmState.events[idx];
                            farmState.harvestLog.push({ time: Date.now(), text: `收获 ${crop.icon}${plot.crop} ×${actualYield} → ${selectedShelter}` });
                            await saveState();
                            renderPanel();
                            overlay.remove();
                            showToast(`📦 收获 ${crop.icon}${plot.crop} ×${actualYield}`);
                            // 异步存入庇护所
                            storeCropToShelter(plot.crop, actualYield, selectedShelter).then(ok => {
                                if (ok) {
                                    showToast(`📦 已存入${selectedShelter}`);
                                } else {
                                    showToast('❌ 存入失败，请检查庇护所状态');
                                }
                                refreshShelters(false);
                            });
                        });
                    }
                }

                overlay.querySelector('#h-cancel').addEventListener('click', () => overlay.remove());
                overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
                return;
            }

            // 生长中的作物：显示详情
            if (info.stageIdx < 4) {
                showCropDetail(plot, idx, info);
                return;
            }

            // 可收获：立即收获并存入
            const yield_ = calcYield(plot, idx);
            farmState.plots[idx] = null;
            delete farmState.events[idx];
            farmState.harvestLog.push({ time: Date.now(), text: `收获 ${crop.icon}${plot.crop} ×${yield_} → ${selectedShelter}` });
            await saveState();
            renderPanel();
            showToast(`📦 收获 ${crop.icon}${plot.crop} ×${yield_}`);
            // 异步存入庇护所（不阻塞UI）
            storeCropToShelter(plot.crop, yield_, selectedShelter).then(ok => {
                if (ok) {
                    showToast(`📦 已存入${selectedShelter}`);
                } else {
                    showToast('❌ 存入失败，请检查庇护所状态');
                }
                refreshShelters(false);
            });
        });
    }

    // ==================== 种植交互 ====================
    p._farmPlant = function (idx) {
        p.document.querySelectorAll('.crop-picker-overlay').forEach(el => el.remove());

        const overlay = p.document.createElement('div');
        overlay.className = 'crop-picker-overlay';

        const picker = p.document.createElement('div');
        picker.className = 'crop-picker';
        if (panel.classList.contains('farm-force-light')) picker.classList.add('farm-picker-light');

        let optionsHtml = '<div class="crop-picker-title">🌱 选择作物</div><div class="crop-picker-list">';
        Object.entries(CROPS).forEach(([name, crop]) => {
            optionsHtml += `
                <div class="crop-option" data-crop="${name}">
                    <span class="crop-option-icon">${crop.icon}</span>
                    <div class="crop-option-info">
                        <div class="crop-option-name">${name}</div>
                        <div class="crop-option-meta">${crop.desc} · 产出×${crop.yield} · 抗性${Math.round(crop.resist * 100)}%</div>
                    </div>
                    <span class="crop-option-time">${formatMin(crop.growMin)}</span>
                </div>`;
        });
        optionsHtml += '</div>';
        picker.innerHTML = optionsHtml;
        overlay.appendChild(picker);
        p.document.body.appendChild(overlay);

        picker.querySelectorAll('.crop-option').forEach(opt => {
            opt.addEventListener('click', async () => {
                const cropName = opt.dataset.crop;
                // 肥料继承上一茬，水量和健康重置为100
                const prevPlot = farmState.plots[idx];
                const prevFert = prevPlot?.fertilizer ?? 75;
                farmState.plots[idx] = { crop: cropName, plantedAt: Date.now(), water: 100, fertilizer: prevFert, health: 100 };
                await saveState();
                overlay.remove();
                renderPanel();
                showToast(`🌱 种下了${cropName}`);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    };

    // ==================== 定时刷新（后台持续运行）====================
    /**
     * 启动定时器：每5秒执行道具恢复、属性衰减、随机事件检查
     * 注意：即使面板最小化也会继续运行，确保游戏逻辑不中断
     */
    function startTick() {
        if (tickInterval) clearInterval(tickInterval);
        tickInterval = setInterval(() => {
            regenItems();
            decayPlotAttrs();
            checkRandomEvents();
            // 只有面板打开时才重新渲染UI
            const hasPlots = farmState.plots.some(p => p !== null);
            if (hasPlots && !farmConfig.isMinimized) {
                renderPanel();
            }
        }, 5000);
    }

    // ==================== 拖拽 & 缩放（Pointer Events 统一处理）====================
    /**
     * 拖拽状态管理
     * 使用 Pointer Events API 统一处理鼠标和触摸事件，避免双触发问题
     */
    let activeEl = null;           // 当前拖拽的元素
    let mode = null;               // 拖拽模式：'drag' | 'resize'
    let startX = 0, startY = 0;    // 拖拽起点坐标
    let startLeft = 0, startTop = 0; // 元素初始位置
    let startWidth = 0, startHeight = 0; // 元素初始尺寸
    let isDragging = false;        // 是否正在拖拽（用于区分点击和拖拽）

    /**
     * 指针按下事件处理
     */
    const onPointerDown = (e) => {
        const el = e.currentTarget._el;
        const m = e.currentTarget._mode;

        activeEl = el;
        mode = m;
        isDragging = false;

        // 拖拽面板时，移除居中 transform 并转换为像素坐标
        if (el === panel && panel.style.transform) {
            const rect = panel.getBoundingClientRect();
            panel.style.transform = 'none';
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
        }

        startX = e.clientX;
        startY = e.clientY;
        startLeft = el.offsetLeft;
        startTop = el.offsetTop;
        startWidth = el.offsetWidth;
        startHeight = el.offsetHeight;

        // 禁用 bubble 的过渡动画，避免拖拽时抖动
        if (el === bubble) {
            bubble.style.transition = 'none';
        }

        // 阻止默认行为（避免文本选择、图片拖拽等）
        e.preventDefault();
    };

    /**
     * 指针移动事件处理
     */
    const onPointerMove = (e) => {
        if (!activeEl) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // 移动距离超过5px才认为是拖拽（避免误触）
        if (!isDragging && Math.hypot(dx, dy) > 5) {
            isDragging = true;
        }

        if (!isDragging) return;

        if (mode === 'drag') {
            // 拖拽模式：更新位置
            activeEl.style.left = Math.max(0, startLeft + dx) + 'px';
            activeEl.style.top = Math.max(0, startTop + dy) + 'px';
        } else if (mode === 'resize') {
            // 缩放模式：更新尺寸
            activeEl.style.width = Math.max(300, startWidth + dx) + 'px';
            activeEl.style.height = Math.max(400, startHeight + dy) + 'px';
        }
    };

    /**
     * 指针释放事件处理
     */
    const onPointerUp = () => {
        if (!activeEl) return;

        // 保存位置/尺寸到配置
        if (activeEl === bubble) {
            saveConfig({
                bubbleTop: bubble.style.top,
                bubbleLeft: bubble.style.left
            });
            bubble.style.transition = 'transform 0.2s ease';
        } else if (activeEl === panel) {
            saveConfig({
                panelLeft: panel.style.left,
                panelTop: panel.style.top,
                panelWidth: panel.style.width,
                panelHeight: panel.style.height
            });
        }

        // 如果不是拖拽（只是点击），则切换面板显示状态
        if (activeEl === bubble && !isDragging) {
            togglePanel();
        }

        activeEl = null;
        mode = null;
        isDragging = false;
    };

    /**
     * 切换面板显示/隐藏
     */
    function togglePanel() {
        const showing = panel.style.display !== 'none';
        panel.style.display = showing ? 'none' : 'flex';
        farmConfig.isMinimized = showing;
        saveConfig();

        if (!showing) {
            // 双端统一居中显示
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.bottom = '';
            panel.style.transform = 'translate(-50%, -50%)';
            refreshShelters(true);
            startTick();
            startEventCheck();
        }
    }

    /**
     * 注册拖拽/缩放事件
     * @param {HTMLElement} el - 要拖拽的元素
     * @param {HTMLElement} handle - 拖拽手柄（触发区域）
     * @param {string} m - 模式：'drag' | 'resize'
     */
    const registerDragHandle = (el, handle, m) => {
        handle._el = el;
        handle._mode = m;
        handle.addEventListener('pointerdown', onPointerDown);
    };

    // 注册拖拽手柄
    registerDragHandle(panel, p.document.getElementById('farm-drag-handle'), 'drag');
    registerDragHandle(panel, p.document.getElementById('farm-footer'), 'drag');
    registerDragHandle(panel, p.document.getElementById('farm-resizer'), 'resize');
    registerDragHandle(bubble, bubble, 'drag');

    // 全局监听指针移动和释放
    p.document.addEventListener('pointermove', onPointerMove);
    p.document.addEventListener('pointerup', onPointerUp);
    p.document.addEventListener('pointercancel', onPointerUp); // 处理意外中断（如切换应用）

    // ==================== 按钮事件 ====================
    // 刷新庇护所列表
    p.document.getElementById('farm-refresh').addEventListener('click', () => refreshShelters(true));

    // 主题切换
    const themeBtn = p.document.getElementById('farm-theme-toggle');
    const themeModes = ['dark', 'light'];
    const themeIcons = { dark: '🌑', light: '☀️' };
    let currentTheme = farmConfig.theme || 'dark';

    /**
     * 应用主题样式
     * @param {string} mode - 主题模式：'dark' | 'light'
     */
    function applyTheme(mode) {
        currentTheme = mode;
        panel.classList.remove('farm-force-light');
        bubble.classList.remove('farm-force-light');
        if (mode === 'light') {
            panel.classList.add('farm-force-light');
            bubble.classList.add('farm-force-light');
        }
        themeBtn.textContent = themeIcons[mode];
        themeBtn.title = mode === 'dark' ? '暗色模式（点击切换亮色）' : '亮色模式（点击切换暗色）';
        saveConfig({ theme: mode });
    }
    applyTheme(currentTheme);

    themeBtn.addEventListener('click', () => {
        const nextIdx = (themeModes.indexOf(currentTheme) + 1) % themeModes.length;
        applyTheme(themeModes[nextIdx]);
    });

    // 清空农田
    p.document.getElementById('farm-clear-plots').addEventListener('click', async () => {
        const hasPlots = farmState.plots.some(p => p !== null);
        if (!hasPlots) return;
        farmState.plots = new Array(PLOT_COUNT).fill(null);
        farmState.events = {};
        await saveState();
        renderPanel();
        showToast('🧹 农田已清空');
    });

    // 停用农场（数据保留，UI 完全移除）
    p.document.getElementById('farm-disable').addEventListener('click', async () => {
        if (confirm('确定停用农场吗？\n\n数据会保留，下次启用酒馆助手时自动恢复。')) {
            await saveState();
            await saveConfig();
            window._farmCleanup();
        }
    });

    // ==================== 监听 MVU 变量更新 ====================
    let mvuEventHandler = null; // 保存事件处理器引用，用于清理

    try {
        if (typeof eventOn === 'function' && Mvu?.events) {
            mvuEventHandler = async () => {
                if (!farmConfig.isMinimized) {
                    await refreshShelters(false);
                }
            };
            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, mvuEventHandler);
        }
    } catch (e) { console.warn('[小农场] MVU事件监听失败:', e); }

    // ==================== 初始加载（冷读取模式）====================
    await initMvu();

    // 从 MVU 同步数据到本地（跨设备数据统一）
    if (mvuReady) {
        const synced = await syncFromMvu();
        if (synced) {
            selectedShelter = farmConfig.selectedShelter || selectedShelter;
            await loadState(selectedShelter);
            console.log('[小农场] 已从 MVU 同步农场数据');
        }
    }

    if (!farmConfig.isMinimized) {
        startTick();
        startEventCheck();
        renderPanel();
    }

    // 事件委托只需绑定一次（body 元素不会被重建）
    bindItemDragDrop();
    bindPlotClicks();

    console.log('[小农场] 插件已加载 🌻', mvuReady ? '(MVU已连接·冷读取模式)' : '(MVU未连接)');

    // ==================== 清理函数：脚本关闭时移除所有 DOM 和定时器 ====================
    /**
     * 完整清理函数：移除 UI、停止定时器、取消事件监听
     * 在酒馆助手禁用脚本或页面卸载时自动调用
     */
    window._farmCleanup = () => {
        // 尽力保存当前状态（pagehide/beforeunload 场景下的安全网）
        try { saveState(); saveConfig(); } catch (e) { /* 忽略 */ }

        // 停止所有定时器
        if (tickInterval) {
            clearInterval(tickInterval);
            tickInterval = null;
        }
        if (eventCheckInterval) {
            clearInterval(eventCheckInterval);
            eventCheckInterval = null;
        }

        // 移除 MVU 事件监听器
        if (mvuEventHandler && typeof eventRemoveListener === 'function' && Mvu?.events) {
            try {
                eventRemoveListener(Mvu.events.VARIABLE_UPDATE_ENDED, mvuEventHandler);
                mvuEventHandler = null;
            } catch (e) {
                console.warn('[小农场] MVU事件监听器移除失败:', e);
            }
        }

        // 移除全局事件监听器
        p.document.removeEventListener('pointermove', onPointerMove);
        p.document.removeEventListener('pointerup', onPointerUp);
        p.document.removeEventListener('pointercancel', onPointerUp);

        // 移除所有 DOM 元素
        const bp = p.document.getElementById('farm-bubble');
        const pp = p.document.getElementById('farm-panel');
        if (bp) bp.remove();
        if (pp) pp.remove();
        p.document.querySelectorAll('.crop-picker-overlay, .crop-detail-popup, .harvest-popup, .farm-toast').forEach(el => el.remove());

        // 清空全局引用
        window._farmCleanup = undefined;

        console.log('[小农场] 已完全清理');
    };

    // 注册页面卸载事件（酒馆助手禁用脚本时触发）
    window.addEventListener('pagehide', window._farmCleanup);
    window.addEventListener('beforeunload', window._farmCleanup);
})();
