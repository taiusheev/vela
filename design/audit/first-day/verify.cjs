const { chromium } = require(process.env.VELA_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.VELA_BROWSER_EXECUTABLE ? { executablePath: process.env.VELA_BROWSER_EXECUTABLE } : {})});
 const page=await browser.newPage({viewport:{width:1050,height:1100}});
 const errors=[]; const checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8786/design/audit/first-day/prototype.html');
 const screen=page.locator('#screen');
 assert.equal(await screen.locator('.day.lit').count(),5);
 await page.locator('.phone').screenshot({path:'design/audit/first-day/today.png'});
 await screen.getByRole('button',{name:'Reply',exact:true}).click();
 assert.equal(await screen.locator('#now').getAttribute('aria-pressed'),'true');
 await screen.locator('#words').fill('mom, show me the basil?');
 await screen.locator('#later').click();
 assert.equal(await screen.locator('#words').inputValue(),'mom, show me the basil?');
 await screen.locator('#now').click();
 await screen.locator('#send').click();
 assert.match(await screen.innerText(),/Accepted for delivery · example/);
 assert.doesNotMatch(await screen.innerText(),/Delivered to Mom/);
 checks.push('Reply has one arrow; composer switches now/morning without losing draft; receipt says accepted, not delivered');
 await page.locator('.phone').screenshot({path:'design/audit/first-day/conversation.png'});
 await page.locator('#stage').selectOption('pending');
 await screen.getByRole('button',{name:'Set it up now'}).click();
 await screen.locator('#morning-time').fill('09:15');
 await screen.locator('#save-morning').click();
 assert.match(await screen.locator('#settings-status').innerText(),/after Mom joins/);
 await page.locator('.nav [data-screen="home"]').click();
 assert.match(await screen.innerText(),/09:15/);
 await page.locator('.phone').screenshot({path:'design/audit/first-day/pending.png'});
 await screen.getByRole('button',{name:'Write her first message'}).click();
 assert.equal(await screen.locator('#now').isDisabled(),true);
 await screen.locator('#words').fill('mom, did you get to the market?');
 await screen.locator('#send').click();
 assert.match(await screen.innerText(),/Saved for after Mom joins/);
 checks.push('Pending parent can edit morning; saved value is shown; send-now disabled before consent; first message stays saved');
 await page.locator('.nav [data-screen="family"]').click();
 await screen.getByRole('button',{name:'People nearby'}).click();
 await screen.getByRole('button',{name:'Review invitation'}).click();
 assert.ok((await page.locator('#invite-words').inputValue()).split(/\s+/).length<35);
 await page.locator('#invite-words').fill('Hi Anna, could I ask you to look in on Mom if I cannot reach her?');
 await page.locator('#share-helper').click();
 assert.match(await page.locator('#share-status').innerText(),/Nothing was shared/);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#modal').isHidden(),true);
 checks.push('Helper invitation is short, editable and honest about noncontact links; share preview and keyboard escape work');
 await page.locator('.guide [data-modal="voice"]').click();
 await page.locator('#voice-example').fill('mom, what did you cook today?');
 await page.locator('#add-example').click();
 assert.match(await page.locator('#voice-status').innerText(),/No AI call/);
 await page.locator('#use-draft').click();
 assert.equal(await screen.locator('#words').inputValue(),'mom, what did you cook today?');
 checks.push('Style example can become editable draft; synthetic personalization explicitly identified');
 for(const width of [320,390,430,736,1050]){
  await page.setViewportSize({width,height:1100});
  for(const stage of ['first','pending','week']){
   await page.locator('#stage').selectOption(stage);
   for(const name of ['home','chat','family','morning','nearby']){
    await page.evaluate(name=>document.querySelector(`.guide [data-screen="${name}"]`)?.click(),name);
    if(name==='home')await page.locator('.nav [data-screen="home"]').click();
    if(name==='family')await page.locator('.nav [data-screen="family"]').click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,`${width} ${stage} ${name}`);
   }
  }
  checks.push(`All family stages and views fit ${width}px`);
 }
 await page.locator('#stage').selectOption('first');
 await screen.locator('#begin').click();
 assert.match(await screen.innerText(),/Waiting for her yes/);
 checks.push('Welcome action reaches useful preacceptance setup');
 assert.deepEqual(errors,[]);
 fs.writeFileSync('design/audit/first-day/verification.json',JSON.stringify({date:'2026-10-15',scope:'Synthetic standalone HTML prototype only. No native/device/provider/family proof.',checks,errors},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,errors:errors.length,result:'passed'}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
