const { spawn } = require('child_process');
const path = require('path');

function runServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting server...');
    const server = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    server.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    // Wait 3 seconds for server to start and connect to MongoDB
    setTimeout(() => {
      resolve(server);
    }, 3000);
  });
}

function runTestScript(scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`Running test script: ${scriptName}...`);
    const test = spawn('node', [scriptName], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    test.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test script ${scriptName} exited with code ${code}`));
      }
    });

    test.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  let serverProcess;
  try {
    serverProcess = await runServer();
    await runTestScript('test_guest_pay_safe.js');
    console.log('All tests passed successfully!');
    if (serverProcess) serverProcess.kill();
    process.exit(0);
  } catch (err) {
    console.error('Test execution failed:', err);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  }
}

main();
