// Official list prices, image/text input only. No video input or subscription discount.
// https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1
export const seedanceModel='doubao-seedance-2-5-260628';
export const seedancePriceDate='2026-11-17';
export const seedancePriceUrl='https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1';
const sizes={
 '720p':{'16:9':[1280,720],'9:16':[720,1280],'1:1':[960,960],'4:3':[1112,834],'3:4':[834,1112],'21:9':[1470,630]},
 '1080p':{'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1440,1440],'4:3':[1664,1248],'3:4':[1248,1664],'21:9':[2206,946]}
};
export const seedanceRate=resolution=>resolution==='720p'?70:resolution==='1080p'?77:NaN;
export function seedanceEstimate(settings,adaptive=false){
 const table=sizes[settings.resolution],rate=seedanceRate(settings.resolution);
 if(!table||!table[settings.ratio]||!Number.isInteger(settings.duration)||settings.duration<4||settings.duration>30)throw Error('官方视频参数不受支持。');
 const pixels=(adaptive?Object.values(table):[table[settings.ratio]]).map(([w,h])=>w*h);
 const costs=pixels.map(p=>settings.duration*p*24/1024*rate/1e6);
 const low=Math.floor(Math.min(...costs)*100)/100,high=Math.ceil(Math.max(...costs)*100)/100;
 return {low,high,rate,priceDate:seedancePriceDate,currency:'CNY',estimated:true,label:low===high?`¥${high.toFixed(2)}`:`¥${low.toFixed(2)}–${high.toFixed(2)}`,
  summary:`按官方公开单价 ${rate} 元/百万 token、24 fps、${settings.duration} 秒估算；${adaptive?'比例跟随首帧，范围参考常见比例；':''}最终按实际用量结算，此预估不是费用上限，不含资源包或折扣。价格核对日期：${seedancePriceDate}。`};
}
