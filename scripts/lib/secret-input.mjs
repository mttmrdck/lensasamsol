export async function hiddenInput(prompt) {
  process.stdout.write(prompt);
  if(!process.stdin.isTTY) throw new Error('Use an interactive terminal for hidden password entry.');
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const onData=data=>{for(const c of data) {
      if(c==='\u0003'){finish();reject(new Error('Cancelled'));return;}
      if(c==='\r'||c==='\n'){finish();resolve(value);return;}
      if(c==='\u007f'||c==='\b') value=value.slice(0,-1); else if(value.length<512) value+=c;
    }};
    process.stdin.on('data',onData);
  });
}
