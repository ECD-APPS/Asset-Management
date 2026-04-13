const mongoose = require('mongoose');
const Store = require('../models/Store');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only overwrite stored passwords when startup explicitly requests it (ENFORCE_DEFAULT_ACCOUNTS=true). */
const shouldSyncPasswordOnUpdate = (resetPasswords) => Boolean(resetPasswords);

const resolveSuperAdminPlainPassword = () => {
  const fromEnv = String(process.env.DEFAULT_SUPERADMIN_PASSWORD || '').trim();
  if (fromEnv) return fromEnv;
  return 'superadmin123';
};

const findUsersByEmailLoose = async (email) => {
  const canonical = String(email || '').trim().toLowerCase();
  // Match same email with optional accidental spaces + any case
  return User.find({
    email: { $regex: new RegExp(`^\\s*${escapeRegex(canonical)}\\s*$`, 'i') }
  });
};

const pickPrimaryUser = (users, canonicalEmail) => {
  if (!Array.isArray(users) || users.length === 0) return null;
  const exact = users.find((u) => String(u.email || '').trim().toLowerCase() === canonicalEmail);
  return exact || users[0];
};

const archiveDuplicateEmail = async (userDoc) => {
  userDoc.email = `legacy_${userDoc._id}@legacy.local`;
  await userDoc.save();
};

const seedStoresAndUsers = async (options = {}) => {
  try {
    const resetPasswords = options.resetPasswords !== false;
    // 1. Create Stores
    const storesData = [
      { name: 'SCY ASSET' },
      { name: 'IT ASSET' },
      { name: 'NOC ASSET' }
    ];

    const storeMap = {};

    for (const sData of storesData) {
      let store = await Store.findOne({ name: sData.name });
      if (!store) {
        store = await Store.create({ ...sData, isMainStore: true });
        console.log(`Created Main Store: ${sData.name}`);
      } else {
        if (!store.isMainStore) {
            store.isMainStore = true;
            await store.save();
            console.log(`Updated Store (set Main): ${sData.name}`);
        } else {
            console.log(`Store exists: ${sData.name}`);
        }
      }
      storeMap[sData.name] = store;
    }

    const buildHash = async (plainText) => {
      const salt = await bcrypt.genSalt(10);
      return bcrypt.hash(plainText, salt);
    };

    // 2. Create/Normalize Super Admin
    const superAdminEmail = 'superadmin@expo.com';
    const superAdminCanonical = superAdminEmail.toLowerCase();
    const superAdminMatches = await findUsersByEmailLoose(superAdminEmail);
    let superAdmin = pickPrimaryUser(superAdminMatches, superAdminCanonical);
    const superPlain = resolveSuperAdminPlainPassword();
    const superAdminHashedPassword = await buildHash(superPlain);

    if (!superAdmin) {
      superAdmin = await User.create({
        name: 'Super Admin',
        email: superAdminEmail,
        password: superAdminHashedPassword,
        role: 'Super Admin',
        assignedStore: null
      });
      console.log(`Created Super Admin: ${superAdminEmail}`);
    } else {
      // If there are duplicate variants of this account, archive extras first.
      for (const candidate of superAdminMatches) {
        if (String(candidate._id) !== String(superAdmin._id)) {
          await archiveDuplicateEmail(candidate);
          console.log(`Archived duplicate user email record for ${superAdminEmail}: ${candidate._id}`);
        }
      }
      superAdmin.name = 'Super Admin';
      superAdmin.email = superAdminEmail;
      superAdmin.role = 'Super Admin';
      superAdmin.assignedStore = null;
      if (shouldSyncPasswordOnUpdate(resetPasswords)) {
        superAdmin.password = superAdminHashedPassword;
      }
      await superAdmin.save();
      console.log(`Updated Super Admin profile: ${superAdminEmail}`);
    }

    // 3. Create Default Store Admins
    const defaultAdmins = [
      { name: 'SCY Admin', email: 'scy@expo.com', storeName: 'SCY ASSET', password: 'admin123' },
      { name: 'IT Admin', email: 'it@expo.com', storeName: 'IT ASSET', password: 'admin123' },
      { name: 'NOC Admin', email: 'noc@expo.com', storeName: 'NOC ASSET', password: 'admin123' }
    ];

    for (const adminData of defaultAdmins) {
      const store = storeMap[adminData.storeName];
      
      if (store) {
        const canonicalAdminEmail = String(adminData.email).toLowerCase();
        const adminMatches = await findUsersByEmailLoose(adminData.email);
        let adminUser = pickPrimaryUser(adminMatches, canonicalAdminEmail);
        
        const hashedPassword = await buildHash(adminData.password);
        if (!adminUser) {
          await User.create({
            name: adminData.name,
            email: adminData.email,
            password: hashedPassword,
            role: 'Admin',
            assignedStore: store._id
          });
          console.log(`Created ${adminData.name}: ${adminData.email}`);
        } else {
          for (const candidate of adminMatches) {
            if (String(candidate._id) !== String(adminUser._id)) {
              await archiveDuplicateEmail(candidate);
              console.log(`Archived duplicate user email record for ${adminData.email}: ${candidate._id}`);
            }
          }
          adminUser.name = adminData.name;
          adminUser.email = String(adminData.email).toLowerCase();
          adminUser.role = 'Admin';
          adminUser.assignedStore = store._id;
          if (shouldSyncPasswordOnUpdate(resetPasswords)) {
            adminUser.password = hashedPassword;
          }
          await adminUser.save();
          console.log(`Updated profile for ${adminData.email}`);
        }
      } else {
        console.error(`Store ${adminData.storeName} not found for admin ${adminData.email}`);
      }
    }

    console.log(`Seeding Stores, Super Admin, and Default Admins completed (resetPasswords=${resetPasswords}).`);

  } catch (error) {
    console.error('Seeding error:', error);
  }
};

module.exports = seedStoresAndUsers;
