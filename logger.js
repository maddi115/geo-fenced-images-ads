const Logger = {
  log: (action, details) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[%c${timestamp}%c] %c${action.toUpperCase()}%c: ${details}`, 
      "color: gray", "color: inherit", "color: #0066ff; font-weight: bold", "color: inherit");
  }
};
