// Synthetic contract fixture. No production HTML, contacts, accounts or card data.
export const reservationNumber = "2099010200000000";
export const entry =
  "https://parcel.epost.go.kr/general.RetrieveGeneralNewGubunLogin.parcel";
export const list =
  "https://parcel.epost.go.kr/general.RetrieveResrevationNew.parcel";
export function loginHTML() {
  return `<html><body><form name="frmLogin"><input name="id"><input name="passwd" type="password"></form>
    <script>function checkVal(){location.href=${JSON.stringify(entry)}}</script></body></html>`;
}
export function formHTML({
  draftCount = 0,
  date = "2099-01-02",
  duplicate = false,
} = {}) {
  const fields = [
    "curCnt",
    "custName",
    "labname",
    "newPostNum",
    "postAddr",
    "detailAddr",
    "cell1",
    "cell2",
    "cell3",
    "phone1",
    "phone2",
    "phone3",
    "labmobile_num",
    "email",
    "labemail",
    "feeChargeYN",
    "wishReceiptTime",
    "wishReceiptDate",
    "hopeRceptDe",
    "hopeReceiptDate",
    "wishReceiptTimeText",
    "pickupKeepNm",
    "receiverName",
    "newRePostNum",
    "rePostAddr",
    "reDetailAddr",
    "reCell1",
    "reCell2",
    "reCell3",
    "rePhone1",
    "rePhone2",
    "rePhone3",
    "sendCustName",
    "newSendPostNum",
    "sendPostAddr",
    "sendDetailAddr",
    "sendCell1",
    "sendCell2",
    "sendCell3",
    "sendPhone1",
    "sendPhone2",
    "sendPhone3",
    "packSer",
    "packSerSel",
    "maincontcd",
    "cont",
    "demand",
    "gCnt",
    "reportMethod",
    "wishReceiptTimeInterval",
    "newPostNum0",
    "labpostNum0",
    "newSendPostNum0",
    "newRePostNum0",
    "pickParty",
    "pickArea",
    "pickMan",
    "wishReceiptTimeNm",
  ];
  const finalFields = [
    "sendMailYn",
    "r_wishReceiptTime",
    "r_wishReceiptTimeInterval",
    "r_pickParty",
    "r_pickArea",
    "r_pickMan",
    "payMethCd",
    "methodNew",
    "pickupKeep",
    "pickupKeepNm",
    "mobilReceipt",
    "payMeth",
    "prcPayMethCd",
    "creditNo",
    "creditExp",
    "creditBirth",
    "creditPwd",
  ];
  const inputs = (names, ids = true) =>
    names
      .map((name) => `<input ${ids ? `id="${name}"` : ""} name="${name}">`)
      .join("");
  const select = (name, code) =>
    `<select id="${name}" name="${name}"><option value="">선택</option><option value="${code}">예시 선택</option></select>`;
  return `<html><body>
  <form id="genAmtForm">${inputs(fields)}${select("limit_wg", "02")}${select("limit_vol", "02")}${select("productCodeCombo", "023")}${select("pickupKeep", "01")}
    <input type="checkbox" id="parcelUseGuideInfoChkBox"><input type="radio" name="charge" value="001"><input type="radio" name="method" value="3">
    <input type="radio" name="sendPrsnMeetYn" value="X"><input type="radio" name="mobilReceipt" value="N">
    <select id="labwishReceiptTime"></select><select id="labwishReceiptTimeNm"></select>
    <button type="button" id="imgBtn" onclick="addRow()">추가</button>
  </form>
  <form id="frmGetWishDayList"><input name="zipcd"></form>
  <form id="frmGetWishTimeList"><input name="resDate"></form>
  <form id="cardForm">${inputs(["creditNo1", "creditNo2", "creditNo3", "creditNo4", "creditExp1", "creditExp2", "creditPwd1", "creditPwd2", "creditBirth"])}</form>
  <form id="rForm">${inputs(finalFields, false)}<button id="reqBtn" type="button">접수</button></form>
  <script>
    const value=(id)=>document.getElementById(id)?.value||'';
    let rowCount=${Number(draftCount)}; let row={};
    window.dataProvider={getRowCount:()=>rowCount,getJsonRow:()=>row};
    function refreshWishDayTime(){document.querySelector('#labwishReceiptTime').innerHTML='<option value="${date}">${date}</option>';}
    function refreshWishTime(){
      document.querySelector('#frmGetWishTimeList [name="resDate"]').value='${date}';
      document.querySelector('#labwishReceiptTimeNm').innerHTML='<option value="09:00~16:00">09:00~16:00</option>';
      window.arrWishTime=[[null,null,null,null,null,null,null,'09:00~16:00','0900','1600','staff','area','office']];
    }
    function addRow(){rowCount++;row={
      gridReName:value('receiverName'),gridReZipcd:value('newRePostNum'),gridRePostAddr:value('rePostAddr'),
      gridReCell:['reCell1','reCell2','reCell3'].map(value).join(''),gridRePhone:['rePhone1','rePhone2','rePhone3'].map(value).join(''),
      gridCharge:'001',gridMethod:'3',gridLimit_wg:value('limit_wg'),gridLimit_vol:value('limit_vol'),gridPackSer:'02',
      gridLabProductCode:'023',gridLabcont:value('cont'),gridCustName:value('labname'),gridPostNum:value('newPostNum'),girdPostAddr:value('postAddr'),
      girdCell:['cell1','cell2','cell3'].map(value).join(''),girdPhone:['phone1','phone2','phone3'].map(value).join(''),
      gridSendName:value('sendCustName'),gridSendZipcd:value('newSendPostNum'),girdSendPostAddr:value('sendPostAddr'),
      girdSendCell:['sendCell1','sendCell2','sendCell3'].map(value).join(''),girdSendPhone:['sendPhone1','sendPhone2','sendPhone3'].map(value).join('')
    };}
    window.reqBtn=function(){
      ${duplicate ? "fetch('/general.InsertNewGeneralReserve.parcel',{method:'POST'}).catch(()=>{});" : ""}
      document.querySelector('#rForm').submit();
    };
  </script></body></html>`;
}
export function listHTML({
  remaining = "1",
  cancelable = true,
  missing = false,
} = {}) {
  return `<html><body><form id="retrieveResFrm">
  <input name="recDateStart" value="20990102"><input name="recDateEnd" value="20990102"><input name="serviceGubun">
  <table>${
    missing
      ? ""
      : `<tr><td><input name="visitRecevResSer" value="${reservationNumber}">
  <input name="rdreserv" type="radio" onclick="window.resSer='${reservationNumber}'"><input name="cur_box_amt" value="${remaining ?? ""}"></td></tr>`
  }</table></form>
  <script>
    const detail=document.implementation.createHTMLDocument('detail');
    detail.body.innerHTML='<input name="yn" type="checkbox" ${cancelable ? "" : "disabled"}><input name="chkYn" value="n">';
    Object.defineProperty(detail,'readyState',{value:'complete'});
    window.resAmtDetail={document:detail,chkCount:()=>0,getDisabledCheck:()=>${cancelable ? "0" : "1"}};
    window.getGubun=()=> '1';
    window.cancelResAmt=()=>{fetch('/general.RemoveResAmt.parcel',{method:'POST'}).then(()=>location.href=${JSON.stringify(list)});};
  </script></body></html>`;
}
