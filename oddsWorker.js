/* oddsWorker.js – self‑contained worker
   -------------------------------------------------- */

/* 1.  tiny data the worker needs (values array) */
const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

/* 2.  minimal hand‑evaluator function – rank only */
function evaluateHandStrength(cards){
  const counts={}, suits={};
  cards.forEach(c=>{
    counts[c.value]=(counts[c.value]||0)+1;
    suits [c.suit ]=(suits [c.suit ]||0)+1;
  });
  const freq = Object.values(counts).sort((a,b)=>b-a);
  const flush=Object.values(suits).some(n=>n>=5);

  const idx=cards.map(c=>values.indexOf(c.value)).sort((a,b)=>a-b);
  const uniq=[...new Set(idx)];
  if(uniq.includes(12)) uniq.unshift(-1);            // A‑low
  const straight = uniq.some((_,i,a)=>i>=4 && a[i]-a[i-4]===4);

  let rank=0;
  if(straight&&flush)           rank=8;
  else if(freq[0]===4)          rank=7;
  else if(freq[0]===3&&freq[1]===2) rank=6;
  else if(flush)                rank=5;
  else if(straight)             rank=4;
  else if(freq[0]===3)          rank=3;
  else if(freq[0]===2&&freq[1]===2) rank=2;
  else if(freq[0]===2)          rank=1;
  return {rank};
}

/* 3.  main message handler – runs once per request */
self.onmessage = ({data})=>{
  const {playerHands, communityCards, deck, trialsPerCard}=data;

  /* cards we can still draw */
  const used=[...playerHands[0],...playerHands[1],...communityCards];
  const avail=deck.filter(c=>!used.some(u=>u.value===c.value&&u.suit===c.suit));
  const totalCards=avail.length;

  avail.forEach((card,idx)=>{
    let p1=0,p2=0,tie=0;
    const baseComm=[...communityCards,card];
    const after=deck.filter(c=>![...baseComm,...playerHands[0],...playerHands[1]]
                              .some(u=>u.value===c.value&&u.suit===c.suit));

    for(let t=0;t<trialsPerCard;t++){
      const board=baseComm.slice();
      const pool=after.slice();
      while(board.length<5){
        board.push(...pool.splice(Math.floor(Math.random()*pool.length),1));
      }
      const b1=evaluateHandStrength([...playerHands[0],...board]);
      const b2=evaluateHandStrength([...playerHands[1],...board]);
      if(b1.rank>b2.rank)      p1++;
      else if(b2.rank>b1.rank) p2++;
      else                     tie++;
    }
    const tot=p1+p2+tie;
    const result={
      card,
      p1 :Math.round(p1 /tot*100),
      p2 :Math.round(p2 /tot*100),
      tie:Math.round(tie/tot*100)
    };

    /* progress message */
    self.postMessage({
      type :'progress',
      result,
      done :idx+1,
      total:totalCards
    });
  });

  /* complete message */
  self.postMessage({type:'complete'});
};
