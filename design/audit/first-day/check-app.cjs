const {chromium}=require(process.env.VELA_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.VELA_BROWSER_EXECUTABLE ? { executablePath: process.env.VELA_BROWSER_EXECUTABLE } : {})});const page=await browser.newPage({viewport:{width:430,height:1400}});const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:8788';
await page.goto(base,{waitUntil:'networkidle'});
await page.getByRole('button',{name:'Reply to Mom',exact:true}).click();
await page.getByPlaceholder('Write to Mom').waitFor();
assert.match(await page.locator('body').innerText(),/The tomatoes finally turned/);
await page.getByPlaceholder('Write to Mom').fill('mom, send me a photo of the tomatoes?');
await page.getByRole('button',{name:'Send now',exact:true}).click();
await page.getByText('Example only. Nothing was sent.',{exact:true}).waitFor();
assert.equal(await page.getByPlaceholder('Write to Mom').inputValue(),'');
await page.getByRole('button',{name:'Send now',exact:true}).waitFor();
await page.screenshot({path:'design/audit/first-day/app-conversation.png',fullPage:true});
checks.push('Today Reply opens the named conversation; history stays with Mom; send-now demo clears text and gives an explicit example receipt');
await page.getByRole('button',{name:'Leave something for their morning',exact:true}).click();
await page.getByText('What are you sending?',{exact:true}).waitFor();
assert.match(await page.locator('body').innerText(),/Tomorrow morning/);
checks.push('Morning compose remains independently reachable from the anytime conversation');
await page.goto(base,{waitUntil:'networkidle'});
await page.getByRole('button',{name:'Family settings',exact:true}).click();
await page.getByTestId('morning-settings-m1').click();
const time=page.getByRole('textbox',{name:'Morning time (24-hour HH:MM)'});
await time.fill('09:15');await page.getByRole('button',{name:'Preview settings',exact:true}).click();
await page.getByText('Example settings previewed.',{exact:true}).waitFor();
checks.push('Family header opens You; the named morning control navigates despite hidden duplicate labels; form previews a valid edit truthfully');
await page.goto(base+'/conversation?recipient=unknown',{waitUntil:'networkidle'});
assert.equal(await page.getByRole('button',{name:'Send now',exact:true}).isDisabled(),true);
assert.doesNotMatch(await page.locator('body').innerText(),/The tomatoes finally turned/);
assert.equal(await page.getByRole('button',{name:'Leave something for their morning',exact:true}).count(),0);
checks.push('Unknown recipient neither shows another parent history nor offers an implicit compose for another person');
for(const width of [320,390,430,736]){
 await page.setViewportSize({width,height:1400});
 for(const route of ['/', '/conversation?recipient=m1','/morning-settings?member=m1','/nearby?member=m1','/you']){
  await page.goto(base+route,{waitUntil:'networkidle'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
  assert.equal(overflow,false,`${width}: ${route}`);
 }
 checks.push(`Exported app home/conversation/morning/nearby/family layouts fit ${width}px`);
}
await page.setViewportSize({width:430,height:1600});await page.goto(base,{waitUntil:'networkidle'});
await page.getByText('Mom · 5 days with messages',{exact:true}).waitFor();
await page.screenshot({path:'design/audit/first-day/app-today.png',fullPage:true});
assert.deepEqual(errors,[]);
fs.writeFileSync('design/audit/first-day/app-verification.json',JSON.stringify({date:'2026-10-15',scope:'Exported Expo web in explicit demo mode; synthetic family only. Not signed iPhone, VoiceOver, live provider, or real-family proof.',checks,errors},null,2)+'\n');
console.log(JSON.stringify({result:'passed',checks:checks.length,errors:errors.length}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
