I kept the retry count at 3 because five retries could increase load on the upstream service without supporting capacity information. I clarified the setting as a maximum:

`Retries: 3 (maximum)`