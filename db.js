const MongoClient = require('mongodb').MongoClient;

let database, client

function db(){
  if(database){
    return Promise.resolve(database)
  }else{
    return new Promise((resolve, reject)=>{
      MongoClient.connect(process.env.DB_URL || 'mongodb://localhost:27017/test', (err, dbClient)=> {
        if(err){
          console.log('connection error:', err, process.env.DATABASE_URL)
          reject(err)
        }else{
          client = dbClient
          database = client.db()
          resolve(database)
        }
      })
    })
  }
}

function close(){
  if(client){
    client.close()
  }
}

module.exports = {
  db,
  close
}
