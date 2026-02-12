module.exports = {
  apps: [
    {
      name: 'expo-stores-api',
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        MONGO_URI: 'mongodb://DB_VM_PRIVATE_IP:27017/expo-stores',
        JWT_SECRET: 'CHANGE_ME',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: 587,
        SMTP_EMAIL: '',
        SMTP_PASSWORD: '',
        FROM_NAME: 'Expo Stores',
        CORS_ORIGIN: 'https://example.com'
      },
      time: true,
      out_file: '/var/log/pm2/expo-stores.out.log',
      error_file: '/var/log/pm2/expo-stores.err.log',
      merge_logs: true,
      max_memory_restart: '500M'
    }
  ]
};
