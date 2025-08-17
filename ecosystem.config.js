// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'ticket-backend',
      script: 'app.js',
      instances: 1,          // o 'max' para cluster
      exec_mode: 'fork',     // o 'cluster'
      watch: false,
      env: { NODE_ENV: 'production', PORT: 3001 },
      max_memory_restart: '500M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
      autorestart: true,
      restart_delay: 3000,
    },
  ],
};