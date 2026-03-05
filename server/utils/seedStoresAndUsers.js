const mongoose = require('mongoose');
const Store = require('../models/Store');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

const seedStoresAndUsers = async () => {
  try {
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
    let superAdmin = await User.findOne({ email: superAdminEmail });
    const superAdminHashedPassword = await buildHash('superadmin123');

    if (!superAdmin) {
      superAdmin = await User.create({
        name: 'Super Admin',
        email: superAdminEmail,
        password: superAdminHashedPassword,
        role: 'Super Admin',
        assignedStore: null
      });
      console.log(`Created Super Admin: ${superAdminEmail} / superadmin123`);
    } else {
      superAdmin.name = 'Super Admin';
      superAdmin.role = 'Super Admin';
      superAdmin.assignedStore = null;
      // Keep default deploy credentials deterministic per user requirement.
      superAdmin.password = superAdminHashedPassword;
      await superAdmin.save();
      console.log(`Updated Super Admin defaults: ${superAdminEmail} / superadmin123`);
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
        let adminUser = await User.findOne({ email: adminData.email });
        
        const hashedPassword = await buildHash(adminData.password);
        if (!adminUser) {
          await User.create({
            name: adminData.name,
            email: adminData.email,
            password: hashedPassword,
            role: 'Admin',
            assignedStore: store._id
          });
          console.log(`Created ${adminData.name}: ${adminData.email} / ${adminData.password}`);
        } else {
          adminUser.name = adminData.name;
          adminUser.role = 'Admin';
          adminUser.assignedStore = store._id;
          // Keep default deploy credentials deterministic per user requirement.
          adminUser.password = hashedPassword;
          await adminUser.save();
          console.log(`Updated defaults for ${adminData.email} / ${adminData.password}`);
        }
      } else {
        console.error(`Store ${adminData.storeName} not found for admin ${adminData.email}`);
      }
    }

    console.log('Seeding Stores, Super Admin, and Default Admins completed.');

  } catch (error) {
    console.error('Seeding error:', error);
  }
};

module.exports = seedStoresAndUsers;
