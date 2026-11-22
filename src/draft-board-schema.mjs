import {z} from 'zod';
import {boardLimit,boardLimits,brushStyles,brushWidthRange,noteWidthRange,noteSizeRange,shapes} from './draft-board.mjs';
import {fonts} from './font-choices.mjs';

const coord=z.number().min(-boardLimit).max(boardLimit),size=z.number().positive().max(boardLimit*2);
const color=z.string().regex(/^#[0-9a-f]{6}$/i);
const point=z.tuple([coord,coord]);
const stroke=z.object({kind:z.literal('stroke'),brush:z.enum(Object.keys(brushStyles)),color,points:z.array(point).min(1).max(boardLimits.stroke),width:z.number().int().min(brushWidthRange.min).max(brushWidthRange.max).optional(),throughText:z.literal(true).optional()});
const note=z.object({kind:z.literal('note'),x:coord,y:coord,color,text:z.string().min(1).max(boardLimits.note),scale:z.number().min(.12).max(12).optional(),width:z.number().min(noteWidthRange.min).max(noteWidthRange.max).optional(),font:z.enum(Object.keys(fonts)).optional(),fontSize:z.number().int().min(noteSizeRange.min).max(noteSizeRange.max).optional()});
const shape=z.object({kind:z.literal('shape'),shape:z.enum(Object.keys(shapes)),color,points:z.tuple([point,point]),width:z.number().int().min(1).max(48)});
const png=z.string().max(boardLimits.image).regex(/^data:image\/png;base64,[a-zA-Z0-9+/]+={0,2}$/);
const cut=z.object({kind:z.literal('cut'),points:z.array(point).min(3).max(boardLimits.stroke),x:coord,y:coord,w:size,h:size,ink:png.optional(),text:png.optional()});
const vectorCut=cut.omit({ink:true,text:true}).extend({kind:z.literal('vectorCut')}).refine(({points})=>{
  const x=points.map(p=>p[0]),y=points.map(p=>p[1]);return Math.max(...x)>Math.min(...x)&&Math.max(...y)>Math.min(...y);
});
export const boardSchema=z.object({version:z.union([z.literal(1),z.literal(2),z.literal(3)]),items:z.array(z.discriminatedUnion('kind',[stroke,note,cut,vectorCut,shape])).max(boardLimits.items)}).refine(({items})=>{
  let points=0,text=0,images=0;
  for(const item of items){points+=item.points?.length??0;if(item.kind==='note')text+=item.text.length;if(item.kind==='cut')images+=(item.ink?.length??0)+(item.text?.length??0);}
  return points<=boardLimits.points&&text<=boardLimits.text&&images<=boardLimits.images;
},'画板内容已达到容量上限。');
const revision=z.string().regex(/^[a-f0-9]{64}$/);
export const saveBoardSchema=z.object({board:boardSchema,revision});
export const openBoardSchema=z.object({folder:z.string().max(240),path:z.string().max(240).optional()});
export const saveNamedBoardSchema=z.object({board:boardSchema,folder:z.string().max(240),name:z.string().max(80),legacyRevision:revision.optional(),scratchRevision:revision.nullable().optional()});
export const boardScratchSchema=z.object({board:boardSchema,name:z.string().max(80),legacyRevision:revision.optional()});
export const saveBoardScratchSchema=boardScratchSchema.extend({folder:z.string().max(240),revision:revision.nullable()});
export const updateBoardSchema=saveBoardSchema.extend({path:z.string().max(240)});
