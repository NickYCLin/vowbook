import {expect,it} from "vitest";
import {isGiftCollectionExcluded} from "./wedding-gift-policy";
it.each(["父親","爸爸","母親","媽媽","哥哥","兄長","弟弟","姊姊","姐姐","妹妹"])("excludes immediate family %s",relationshipLabel=>{
 expect(isGiftCollectionExcluded({relationshipLabel})).toBe(true);
});
it("excludes newlyweds and exemptions while keeping cousins, other relatives and unclassified guests",()=>{
 expect(isGiftCollectionExcluded({category:"COUPLE"})).toBe(true);
 expect(isGiftCollectionExcluded({giftExemptWithCake:true})).toBe(true);
 for(const relationshipLabel of [null,"表姊","堂兄","姊夫","伯父"])expect(isGiftCollectionExcluded({relationshipLabel})).toBe(false);
});
