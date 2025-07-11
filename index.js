const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

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
    const usersCollection = db.collection('users'); //collection



    // Add or update user by email
    app.post('/user', async (req, res) => {
      const user = req.body;
      const email = user?.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const filter = { email: email };
      const updateDoc = {
        $setOnInsert: {
          name: user.name,
          photo: user.photo,
          isSubscribed: user.isSubscribed || false,
          createdAt: new Date()
        }
      };

      const options = { upsert: true };
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.status(200).json(result);
    });


    // Get specific user by email
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      try {
        const user = await db.collection('users').findOne({ email });
        if (user) {
          res.json(user);
        } else {
          res.status(404).json({ message: 'User not found' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
      }
    });

    // Patch user subscription status
    app.patch('/user/:email', async (req, res) => {
      const email = req.params.email;
      const updateDoc = {
        $set: {
          isSubscribed: true
        }
      };
      const result = await usersCollection.updateOne({ email }, updateDoc);
      res.send(result);
    });


    // Get Product API 
    app.get('/products', async (req, res) => {
      const userEmail = req.query.email;

      try {
        const query = userEmail ? { ownerEmail: userEmail } : {};

        const products = await techCollection
          .find(query)
          .sort({ createdAt: -1 })  // newest first
          .toArray();

        res.send(products);
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

        res.status(201).send({
          success: true,
          message: 'Product added successfully!',
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ success: false, message: 'Something went wrong.' });
      }
    });


    // Get Single Product by ID
    app.get('/products/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const product = await techCollection.findOne({ _id: new ObjectId(id) });
        if (product) {
          res.send(product);
        } else {
          res.status(404).json({ message: "Product not found" });
        }
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch product' });
      }
    });


    // Update Product API
    app.patch('/products/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = { ...req.body };
      delete updatedData._id;

      try {
        const result = await techCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send(result);
      } catch (err) {
        console.error('Update failed:', err);
        res.status(500).json({ message: 'Update failed' });
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


    // Stripe Payment API
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'usd',
          payment_method_types: ['card'],
        });
        res.json({clientSecret: paymentIntent.client_secret})
      } catch (error) {
        res.status(500).json({error: error.message})
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
