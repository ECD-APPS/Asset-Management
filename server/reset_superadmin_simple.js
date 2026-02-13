const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '.env') });

const resetSuperAdmin = async () => {
  try {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is missing in .env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    const email = 'superadmin@expo.com';
    const password = '123456';

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let user = await User.findOne({ email });
    
    if (user) {
      user.password = hashedPassword;
      // Ensure role is correct
      if (user.role !== 'Super Admin') {
          user.role = 'Super Admin';
      }
      await user.save();
      console.log(`SUCCESS: Password for ${email} has been reset to: ${password}`);
    } else {
      console.log(`User ${email} not found. Creating it...`);
      await User.create({
          name: 'Super Admin',
          email,
          password: hashedPassword,
          role: 'Super Admin',
          assignedStore: null // Super Admin has no fixed store
      });
      console.log(`SUCCESS: Created ${email} with password: ${password}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error resetting password:', error);
    process.exit(1);
  }
};

resetSuperAdmin();
