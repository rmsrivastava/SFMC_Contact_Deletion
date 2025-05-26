<script runat='server'>

    Platform.Load('core', '1');
    HTTPHeader.SetValue("Content-Type", "application/json");

    try {
        var NumBatches = Platform.Function.Lookup("CA_CustomObjectKeyRange", "Batches", "Key", "CA_FY25_ContactsToBeArchived") + 1;

        // Retrieve folder IDs
        var BatchFolderName = "CA_2025_Delete_Batches";
        var BackupFolderName = "CA_2025_BKUP_Batches";

        var BatchFolderID = Folder.Retrieve({ Property: "Name", SimpleOperator: "equals", Value: BatchFolderName })[0].ID;
        var BackupFolderID = Folder.Retrieve({ Property: "Name", SimpleOperator: "equals", Value: BackupFolderName })[0].ID;

        for (var i = 1; i <= NumBatches; i++) {

            // Create Sendable Batch DE
            var batchDEName = "CA_2025_Batch" + i;
            var batchDE = {
                "CustomerKey": batchDEName,
                "Name": batchDEName,
                "CategoryID": BatchFolderID,
                "Fields": [
                    { "Name": "SubscriberKey", "FieldType": "Text", "MaxLength": 254, "IsPrimaryKey": true, "IsRequired": true },
                    { "Name": "EmailAddress", "FieldType": "EmailAddress" }
                ],
                "SendableInfo": {
                    "Field": { "Name": "SubscriberKey", "FieldType": "Text" },
                    "RelatesOn": "Subscriber Key"
                }
            };
            DataExtension.Add(batchDE);
            Write("(+) Sendable Batch DE created: " + batchDEName + "<br>");

            // Create Non-Sendable Backup DE
            var backupDEName = "CA_2025_BKUP_Batch" + i;
            var backupDE = {
                "CustomerKey": backupDEName,
                "Name": backupDEName,
                "CategoryID": BackupFolderID,
                "Fields": [
                    { "Name": "SubscriberKey", "FieldType": "Text", "MaxLength": 254, "IsPrimaryKey": true, "IsRequired": true },
                    { "Name": "EmailAddress", "FieldType": "EmailAddress" }
                ]
            };
            DataExtension.Add(backupDE);
            Write("(+) Backup DE created: " + backupDEName + "<br>");
        }

    } catch (error) {
        Write(Stringify(error));
    }

</script>
