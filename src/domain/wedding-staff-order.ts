/** 依職務預設排序；同職務人員及同順位職務保留原順序。 */
function roleRank(roleName:string) {
 const role=roleName.normalize("NFKC").replace(/\s+/gu,"");
 if(/主持|司儀/u.test(role))return 100;
 if(/攝影|婚攝|^平面$/u.test(role))return 110;
 if(/錄影|婚錄/u.test(role))return 120;
 if(/新娘秘書|新秘/u.test(role))return 130;
 if(/拍拍印/u.test(role))return 140;
 if(/廠商/u.test(role))return 150;
 if(/總招|總召/u.test(role))return 0;
 if(/招待|接待/u.test(role))return 10;
 if(/收禮|禮金/u.test(role))return 20;
 if(/發餅|喜餅發放/u.test(role))return 30;
 return 50;
}
export function sortWeddingStaff<T extends {roleName:string}>(staff:readonly T[]):T[] {
 const groups=new Map<string,T[]>();
 for(const person of staff){const group=groups.get(person.roleName)??[];group.push(person);groups.set(person.roleName,group);}
 return [...groups.entries()].sort(([a],[b])=>roleRank(a)-roleRank(b)).flatMap(([,people])=>people);
}
