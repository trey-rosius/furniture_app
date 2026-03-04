const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  await page.goto('http://localhost:5173');
  
  // Wait for the main page to load
  await page.waitForSelector('h1');
  
  // Take a screenshot of the Home page
  await page.screenshot({ path: 'home-page-screenshot.png' });
  console.log('Took screenshot of home page: home-page-screenshot.png');

  // Find a button/link that says 'Start Designing' or something similar from luxehome
  let designButton = await page.$('a[href="/chat"]');
  if(!designButton) designButton = await page.$('button');

  if (designButton) {
    await designButton.click();
    console.log('Clicked design button');
    
    // Wait for chat to load
    await new Promise(r => setTimeout(r, 2000));
    
    // Screenshot chat page
    await page.screenshot({ path: 'chat-page-screenshot.png' });
    console.log('Took screenshot of chat page: chat-page-screenshot.png');
    
    // Type a message in input
    const inputs = await page.$$('input[type="text"]');
    if (inputs.length > 0) {
      await inputs[0].type('I need a mid-century modern chair');
      await page.keyboard.press('Enter');
      console.log('Typed message and pressed Enter');
      
      // Wait for response
      await new Promise(r => setTimeout(r, 4000));
      
      // Screenshot chat with response
      await page.screenshot({ path: 'chat-response-screenshot.png' });
      console.log('Took screenshot of chat response: chat-response-screenshot.png');
    } else {
      console.log('Could not find chat input.');
    }
  } else {
    console.log('Could not find design button.');
  }

  // Print any console logs from the page
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await browser.close();
})();
