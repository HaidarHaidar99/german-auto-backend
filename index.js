require("dotenv").config();

// Initialized with live production email and Google OAuth providers
const app = require("./src/app");

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] German Auto backend running on port ${PORT}`);
  });
}

module.exports = app;