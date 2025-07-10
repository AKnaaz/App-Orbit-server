const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();


const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wgbv3s7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('techDB'); // database name
    const techCollection = db.collection('techs'); //collection


    // Get Product API 
    app.get('/products', async (req, res) => {
      const userEmail = req.query.email;

      try {
        const query = userEmail ? { ownerEmail: userEmail } : {};

        const products = await techCollection
          .find(query)
          .sort({ createdAt: -1 })  // newest first
          .toArray();

        res.json(products);
      } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Something went wrong' });
      }
    });


    // Add Product API (POST)
    app.post('/add-product', async (req, res) => {
      try {
        const productData = req.body;

        productData.createdAt = new Date();

        const result = await techCollection.insertOne(productData);

        res.status(201).json({
          success: true,
          message: 'Product added successfully!',
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ success: false, message: 'Something went wrong.' });
      }
    });


    // Delete Product API
    app.delete('/products/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const result = await techCollection.deleteOne({ _id: new ObjectId(id) });

        res.send(result);
      } catch (error) {
        console.error('Delete error:', error);
        res.status(500).send({ success: false, message: 'Failed to delete product' });
      }
    });

    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('AppOrbit Server is Running')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
