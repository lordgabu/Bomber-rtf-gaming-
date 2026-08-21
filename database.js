// database.js - Complete version with referral support (OPTIMIZED)
const mongoose = require('mongoose');
const { MONGODB_URL, DB_NAME, ADMIN_IDS } = require('./config');

// ===== OPTIMIZED: Connection pooling =====
mongoose.connect(MONGODB_URL, { 
    dbName: DB_NAME,
    maxPoolSize: 10,          // Maximum connections in pool
    minPoolSize: 2,           // Minimum connections in pool
    socketTimeoutMS: 45000,   // Socket timeout
    serverSelectionTimeoutMS: 5000 // Server selection timeout
})
  .then(() => console.log('✅ MongoDB connected (Pool: 2-10)'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Handle connection events
mongoose.connection.on('error', err => {
    console.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected, attempting to reconnect...');
});

// -------- Schemas --------
const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  credits: { type: Number, default: 0 },
  last_daily: { type: Number, default: 0 },
  total_attacks: { type: Number, default: 0 },
  username: { type: String, default: '' },
  first_name: { type: String, default: '' },
  daily_unlimited: { type: Number, default: 0 },
  bomb_sessions: { type: Array, default: [] },
  last_referral_time: { type: Number, default: 0 },
  referral_code: { type: String, default: '' },
  referral_count: { type: Number, default: 0 },
  referral_used: { type: Boolean, default: false },
  pending_ref_code: { type: String, default: null },
  custom_headers: { type: Object, default: {} },
  scanner_enabled: { type: Boolean, default: false },
  scanner_data: { type: String, default: '' },
  last_active: { type: Number, default: Date.now }  // For tracking active users
});

// Index for faster queries
userSchema.index({ last_active: -1 });
userSchema.index({ total_attacks: -1 });
userSchema.index({ referral_code: 1 });

const User = mongoose.model('User', userSchema);

const protectedSchema = new mongoose.Schema({
  _id: { type: String, default: 'list' },
  numbers: { type: [String], default: [] },
});
const Protected = mongoose.model('Protected', protectedSchema);

const channelSchema = new mongoose.Schema({
  _id: { type: String, default: 'list' },
  channels: { type: [String], default: [] },
});
const Channel = mongoose.model('Channel', channelSchema);

const scannerSchema = new mongoose.Schema({
  _id: { type: String, default: 'config' },
  scanners: { type: [String], default: [] },
  global_headers: { type: Object, default: {} },
});
const Scanner = mongoose.model('Scanner', scannerSchema);

const bannedSchema = new mongoose.Schema({
  _id: { type: String, required: true },
});
const Banned = mongoose.model('Banned', bannedSchema);

const redeemSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  amount: { type: Number, required: true },
});
const Redeem = mongoose.model('Redeem', redeemSchema);

const referralSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  code: { type: String, required: true },
  count: { type: Number, default: 0 },
  used_by: { type: [String], default: [] },
});
const Referral = mongoose.model('Referral', referralSchema);

// -------- Functions --------
async function getUser(userId) {
    const id = String(userId);
    try {
        let user = await User.findById(id);
        if (user) {
            // Update last_active
            if (user.last_active) {
                user.last_active = Date.now();
                await user.save();
            }
            return user;
        }
        user = await User.findOneAndUpdate(
            { _id: id },
            { 
                $setOnInsert: { 
                    _id: id,
                    credits: 0,
                    last_daily: 0,
                    total_attacks: 0,
                    username: '',
                    first_name: '',
                    daily_unlimited: 0,
                    bomb_sessions: [],
                    last_referral_time: 0,
                    referral_code: '',
                    referral_count: 0,
                    referral_used: false,
                    pending_ref_code: null,
                    custom_headers: {},
                    scanner_enabled: false,
                    scanner_data: '',
                    last_active: Date.now()
                }
            },
            { upsert: true, new: true }
        );
        return user;
    } catch (error) {
        console.error('Error in getUser:', error);
        if (error.code === 11000) {
            const user = await User.findById(id);
            if (user) return user;
        }
        try {
            const user = new User({ _id: id });
            await user.save();
            return user;
        } catch (err) {
            if (err.code === 11000) {
                return await User.findById(id);
            }
            throw err;
        }
    }
}

module.exports = {
  getUser,
  
  async updateCredits(userId, amount) {
    const user = await User.findByIdAndUpdate(
      String(userId),
      { $inc: { credits: amount } },
      { new: true }
    );
    return user ? user.credits : 0;
  },

  async updateUserField(userId, field, value) {
    await User.findByIdAndUpdate(String(userId), { [field]: value });
  },

  async getProtected() {
    const doc = await Protected.findOne({ _id: 'list' });
    return doc ? doc.numbers : [];
  },

  async addProtected(phone) {
    await Protected.findOneAndUpdate(
      { _id: 'list' },
      { $addToSet: { numbers: phone } },
      { upsert: true }
    );
  },

  async removeProtected(phone) {
    await Protected.findOneAndUpdate(
      { _id: 'list' },
      { $pull: { numbers: phone } }
    );
  },

  async getChannels() {
    const doc = await Channel.findOne({ _id: 'list' });
    return doc ? doc.channels : [];
  },

  async addChannel(channel) {
    await Channel.findOneAndUpdate(
      { _id: 'list' },
      { $addToSet: { channels: channel } },
      { upsert: true }
    );
  },

  async removeChannel(channel) {
    await Channel.findOneAndUpdate(
      { _id: 'list' },
      { $pull: { channels: channel } }
    );
  },

  async getScannerConfig() {
    let doc = await Scanner.findOne({ _id: 'config' });
    if (!doc) {
      doc = new Scanner({ _id: 'config' });
      await doc.save();
    }
    return doc;
  },

  async addScanner(data) {
    await Scanner.findOneAndUpdate(
      { _id: 'config' },
      { $push: { scanners: data } },
      { upsert: true }
    );
  },

  async removeScanner(index) {
    const doc = await this.getScannerConfig();
    if (index >= 0 && index < doc.scanners.length) {
      doc.scanners.splice(index, 1);
      await doc.save();
      return true;
    }
    return false;
  },

  async updateGlobalHeaders(headers) {
    await Scanner.findOneAndUpdate(
      { _id: 'config' },
      { $set: { global_headers: headers } },
      { upsert: true }
    );
  },

  async isBanned(userId) {
    return !!(await Banned.findById(String(userId)));
  },

  async banUser(userId) {
    await new Banned({ _id: String(userId) }).save();
  },

  async unbanUser(userId) {
    await Banned.findByIdAndDelete(String(userId));
  },

  async createRedeemCode(code, amount) {
    await new Redeem({ _id: code, amount }).save();
  },

  async getRedeemCode(code) {
    const doc = await Redeem.findById(code);
    if (doc) {
      await doc.deleteOne();
      return doc.amount;
    }
    return null;
  },

  async generateReferralCode(userId) {
    const user = await this.getUser(userId);
    if (user.referral_code) return user.referral_code;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    user.referral_code = code;
    await user.save();
    return code;
  },

  async getReferralData(userId) {
    const user = await this.getUser(userId);
    return { code: user.referral_code, count: user.referral_count };
  },

  async processReferral(newUserId, refCode) {
    const owner = await User.findOne({ referral_code: refCode });
    if (!owner) return { success: false, msg: 'Invalid referral code.' };
    if (owner._id === String(newUserId)) return { success: false, msg: 'You cannot use your own referral code.' };

    const newUser = await this.getUser(newUserId);
    if (newUser.referral_used) return { success: false, msg: 'You have already used a referral code.' };

    const now = Date.now() / 1000;

    // Cooldown: 1 minute between referrals, admins exempt
    if (!ADMIN_IDS.includes(Number(owner._id))) {
      if (owner.last_referral_time + 60 > now) {
        return { success: false, msg: 'Please wait 1 minute between referrals.' };
      }
    }

    // Give 5 credits to both
    await this.updateCredits(owner._id, 5);
    await this.updateCredits(newUserId, 5);

    owner.referral_count += 1;
    owner.last_referral_time = now;
    await owner.save();

    newUser.referral_used = true;
    newUser.pending_ref_code = null;
    await newUser.save();

    return { success: true, msg: 'Referral successful! Both got 5 credits! 🎉' };
  },

  async isJoined(userId, bot) {
    if (ADMIN_IDS.includes(Number(userId))) return true;
    const channels = await this.getChannels();
    if (channels.length === 0) return true;
    for (const ch of channels) {
      try {
        const member = await bot.getChatMember(ch, userId);
        if (member.status === 'left' || member.status === 'kicked') return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  },

  User: User
};
