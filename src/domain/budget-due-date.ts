export type DefaultDueDate={date:string;reason:"婚禮當天"|"領禮服當天"};

const GOWN=/婚紗|禮服/u;
const NOT_GOWN=/婚紗照|婚紗攝影|婚紗拍攝/u;

function isGownItem(item:{name:string;breadcrumb:readonly string[];relatedTaxonomyItemKey:string|null}):boolean {
 if(item.relatedTaxonomyItemKey==="ITEM_ATTIRE_RENTAL")return true;
 return [item.name,...item.breadcrumb].some(label=>GOWN.test(label)&&!NOT_GOWN.test(label));
}

function previousDay(date:string):string {
 const day=new Date(`${date}T00:00:00.000Z`);
 day.setUTCDate(day.getUTCDate()-1);
 return day.toISOString().slice(0,10);
}

/**
 * 沒填付款期限時的預設：尾款在婚禮結束當天結清；婚紗、禮服前一天領件時就結清。
 * 只用於顯示與排序，不會寫回資料庫。
 */
export function defaultBalanceDueDate(item:{name:string;breadcrumb:readonly string[];relatedTaxonomyItemKey:string|null},weddingDate:string|null):DefaultDueDate|null {
 if(!weddingDate)return null;
 return isGownItem(item)?{date:previousDay(weddingDate),reason:"領禮服當天"}:{date:weddingDate,reason:"婚禮當天"};
}

export function effectiveDueDate(item:{dueDate:string|null;defaultDueDate?:DefaultDueDate|null}):{date:string;reason:DefaultDueDate["reason"]|null}|null {
 if(item.dueDate)return {date:item.dueDate,reason:null};
 return item.defaultDueDate?{...item.defaultDueDate}:null;
}
