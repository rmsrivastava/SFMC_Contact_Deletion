<script runat="server" type="text/javascript">
  Platform.Load("Core",'1.1');
    
  var rowsData;
  var recordCount = 0;
  var source = DataExtension.Init("ContactsToBeDeleted");
    
  try {
      var processLogRows = Platform.Function.LookupOrderedRows("CA_ProcessLog",1,"LastRowKey desc","Category","BatchCreation");
      var totalProcessed = processLogRows[0]["LastRowKey"];
      var startBatch = 1.0 + processLogRows[0]["BatchNum"];
      var EndBatch = 1.0 + startBatch
      	
      var log1 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Starting point : " + totalProcessed]);
      var depre = "CA_2025_Batch";
	    var bkpre = "CA_2025_BKUP_Batch";
      
      for(s = startBatch; s <= EndBatch; s++){
        var dekey = depre.concat(s);
		    var DE = DataExtension.Init(dekey);
		    var bkkey = bkpre.concat(s);
		    var BK = DataExtension.Init(bkkey);
		    var batchprocessed = 0;
	    	var arr = [];
        var max = 0;
        var log2 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Batch DE Key = " + dekey]);
        
        do {    
          rowsData = source.Rows.Retrieve({Property:"RowKey",SimpleOperator:"greaterThan",Value:totalProcessed});
          recordCount = rowsData.length;
          
          for( i = 0; i < recordCount; i++) {
              var SubKey = rowsData[i].SubscriberKey;
              var EmailAddr = rowsData[i].EmailAddress;
              max = rowsData[i].RowKey;
              var payload = {
                    SubscriberKey: SubKey,
                    EmailAddress: EmailAddr
                    };	
			        var addedRowCount = DE.Rows.Add(payload);
              var addedRowCount2 = BK.Rows.Add(payload);			
			        arr.push(max);
          }
          
          arr.sort(function(a, b){return b-a});
          totalProcessed = arr[0];
          batchprocessed += recordCount;
                
          if(parseFloat(batchprocessed) >= 50000) {			
              break;
          }
      } while (recordCount > 0) 
		
		var processlog = Platform.Function.InsertData("CA_ProcessLog",["BatchName","LastRowKey", "BatchNum"],["S-"+s,totalProcessed, s]);
    var dbuglog = Platform.Function.InsertData("CA_DebugLogs",["log"],["Last processed row after the while Loop in " + "s" + s+ " = " + totalProcessed]);
		}
      
  } catch(e) {
      var debugDE = DataExtension.Init("CA_DebugLogs");
      var arrDebug = [{log: 'Error in CA_2025_PopulateBatches js: ' + Stringify(e)}];
      debugDE.Rows.Add(arrDebug);
    }     
</script> 
