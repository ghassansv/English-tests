import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';

async function main(){
  const input = process.argv[2];
  if(!input){ console.error('Usage: node debug_tess.mjs image'); process.exit(2);}  
  // Try both APIs
  const mod = await import('tesseract.js');
  const T = mod && (mod.default || mod);
  if (T && T.recognize) {
    const res = await T.recognize(input, 'eng');
    fs.writeFileSync(path.join('scripts','tess_raw.json'), JSON.stringify(res.data || res, null, 2));
    console.log('Wrote scripts/tess_raw.json');
    return;
  }
  if (T && T.createWorker) {
    const worker = T.createWorker();
    // try calling recognize directly on worker
    if (typeof worker.recognize === 'function') {
      const { data } = await worker.recognize(input);
      fs.writeFileSync(path.join('scripts','tess_raw.json'), JSON.stringify(data, null, 2));
      console.log('Wrote scripts/tess_raw.json (worker.recognize)');
      if (typeof worker.terminate === 'function') await worker.terminate();
      return;
    }
  }
  throw new Error('No usable tesseract API found');
}

main().catch(err=>{console.error(err); process.exit(1);});
