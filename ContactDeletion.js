<script language="javascript" runat="server"> 
	Platform.Load("core","1");
	
	// Retrieve the latest batch number from the process log and Initialize DE key
	var processLogRows = Platform.Function.LookupOrderedRows("CA_ProcessLog",1,"BatchNum desc","Category","BatchDeletion");
	var batchNm = 1.0;
	if (processLogRows.length > 0) {
	    batchNm += processLogRows[0]["BatchNum"];
	} 
	var depre = "CA_2025_Batch";
	var deKey = depre.concat(batchNm);
	var log1 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Batch DE Key = " + deKey]);
	
	// Authenticate and get the access token
	var auth = HTTP.Post(
		'https://CLIENT_BASE.auth.marketingcloudapis.com/v2/token/', 
		'application/json', 
		'{"grant_type": "client_credentials","client_id":"CLIENT_IT","client_secret":"CLIENT_SECRET","account_id": "PARENTBU_MID"}'
	);
	
	var authobj = Platform.Function.ParseJSON(auth.Response[0]);
	try {
		// If the access token is available, proceed with the deletion request
	    	if (authobj.access_token) {
	    	    var del = HTTP.Post(
	                authobj.rest_instance_url+'contacts/v1/contacts/actions/delete?type=listReference', 
	                'application/json', 
	                '{"deleteOperationType":"ContactAndAttributes","targetList":{"listKey":"' + deKey + '","listType":{"listTypeID":3}},"deleteListWhenCompleted":false,"deleteListContentsWhenCompleted":true}', 
	                ["Authorization"], 
	                ["Bearer " + authobj.access_token]
	           ); 
            // If there are no errors in the deletion response, update process log and log deletion response
            var delobj = Platform.Function.ParseJSON(del.Response[0]);
            if (delobj.hasErrors == false) {
          			    var logthis = Platform.Function.InsertData("CA_ProcessLog",["BatchName","BatchNum", "Category"],["S-"+batchNm,batchNm, "BatchDeletion"]);
          			    var debugDE = DataExtension.Init("CA_DebugLogs");
          			    var arrDebug = [{log: 'delobj: ' + Stringify(delobj)}];
          			    debugDE.Rows.Add(arrDebug);
          	}
	    	  }
    } catch(e) {
          // Log any errors that occur during the process
          var debugDE = DataExtension.Init("CA_DebugLogs");
          var arrDebug = [{log: 'Error in Contact Deletion js: ' + Stringify(e)}];
          debugDE.Rows.Add(arrDebug);
    }
</script>
