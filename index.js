const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



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
    const reportCollection = db.collection('reports'); //collection
    const reviewsCollection = db.collection('reviews'); //collection
    const couponCollection = db.collection('coupons'); //collection


    // custom middlewares
    const verifyFBToken = async(req, res, next) => {
      const authHeader = req.headers.authorization;
      if(!authHeader){
        return res.status(401).send({ message: "unauthorized access"})
      }
      const token = authHeader.split(' ')[1];
      if(!token){
        return res.status(401).send({ message: "unauthorized access"})
      }

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      }
      catch (error) {
        return res.status(403).send({ message: "forbidden access"})
      }
    }

    // Add or update user by email
    app.post('/user', async (req, res) => {
      const user = req.body;
      const email = user?.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const filter = { email: email };
      const updateDoc = {
        $set: {
          name: user.name,
          photo: user.photo,
          isSubscribed: user.isSubscribed || false,
          role: user.role || 'user', 
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      };

      const options = { upsert: true };
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.status(200).json(result);
    });


    // Get all users (for admin)
    app.get('/user', async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).json(users);
      } catch (err) {
        console.error('Failed to fetch users:', err);
        res.status(500).json({ message: 'Failed to fetch users' });
      }
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
    app.patch('/user/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const updateDoc = {
        $set: {
          isSubscribed: true
        }
      };
      const result = await usersCollection.updateOne({ email }, updateDoc);
      res.send(result);
    });


    // Make admin API
    app.patch('/user/admin/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: 'admin' } }
        );
        res.send(result);
      } catch (err) {
        console.error('Make Admin Error:', err);
        res.status(500).json({ message: 'Failed to make admin' });
      }
    });


    // Make moderator API
    app.patch('/user/moderator/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: 'moderator' } }
        );
        res.send(result);
      } catch (err) {
        console.error('Make Moderator Error:', err);
        res.status(500).json({ message: 'Failed to make moderator' });
      }
    });


    // Get user's role by email
    app.get('/user/role/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;

      try {
        // Security check (optional but recommended)
        if (req.decoded.email !== email) {
          return res.status(403).json({ message: 'Forbidden: Email mismatch' });
        }

        const user = await usersCollection.findOne({ email });

        if (user?.role) {
          res.status(200).json({ role: user.role });
        } else {
          res.status(404).json({ message: 'User not found or role missing' });
        }

      } catch (err) {
        console.error('Failed to fetch user role:', err);
        res.status(500).json({ message: 'Failed to fetch role' });
      }
    });


    // Piechart API
    app.get('/admin-statistics', verifyFBToken, async (req, res) => {
      try {
        const productStatusPipeline = [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              status: '$_id',
              count: 1,
              _id: 0
            }
          }
        ];

        const productStatusCountsFromDB = await techCollection.aggregate(productStatusPipeline).toArray();

        // Ensure all statuses (accepted, pending, rejected) are represented
        const allStatuses = ['accepted', 'pending', 'rejected'];
        const productStatusCounts = allStatuses.map(status => {
          const found = productStatusCountsFromDB.find(item => item.status === status);
          return {
            status,
            count: found ? found.count : 0
          };
        });

        const totalUsers = await usersCollection.estimatedDocumentCount();
        const totalReviews = await reviewsCollection.estimatedDocumentCount();

        res.send({
          productStatusCounts,
          totalUsers,
          totalReviews
        });
      } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ message: 'Failed to load admin statistics' });
      }
    });



    // Get Products API (all, by user email, featured or reported)
    app.get('/products', async (req, res) => {
      const userEmail = req.query.email;
      const isFeatured = req.query.featured === 'true';

      try {
        let query = {};

        if (userEmail) {
          query.ownerEmail = userEmail;
        }

        if (isFeatured) {
          query.isFeatured = true;
        }

        const products = await techCollection
          .find(query)
          .sort({ createdAt: -1 }) // Newest first
          .toArray();

        res.send(products);
      } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Something went wrong' });
      }
    });


    // Add Product API (POST)
    app.post('/add-product', verifyFBToken, async (req, res) => {
      try {
        const productData = req.body;

        productData.createdAt = new Date();

        if (!productData.status) {
          productData.status = 'pending';
        }

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


    // PATCH /products/vote/:id
    app.patch('/products/vote/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const { email } = req.body;

      const product = await techCollection.findOne({ _id: new ObjectId(id) });

      if (product.voters?.includes(email)) {
        return res.status(400).json({ message: "Already voted" });
      }

      const result = await techCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $inc: { votes: 1 },
          $push: { voters: email }
        }
      );

      res.send(result);
    });


    // Report API
    app.post('/report', verifyFBToken, async (req, res) => {
      try {
        const reportData = req.body;
        reportData.reportedAt = new Date();

        const result = await reportCollection.insertOne(reportData);
        res.status(201).json({ success: true, message: 'Report submitted', result });
      } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, message: 'Failed to report product' });
      }
    });


    // Get All Reported Products
    app.get('/reports', async (req, res) => {
      try {
        const reports = await reportCollection
          .find()
          .sort({ reportedAt: -1 }) // newest first
          .toArray();
        res.send(reports);
      } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'Failed to fetch reports' });
      }
    });


    // Report Delete API
    app.delete('/reports/:productId', async (req, res) => {
      const productId = req.params.productId;

      try {
        const productResult = await techCollection.deleteOne({ _id: new ObjectId(productId) });

        const reportResult = await reportCollection.deleteMany({ productId });

        res.send({
          message: 'Product and its reports deleted successfully',
          productDeleted: productResult.deletedCount,
          reportsDeleted: reportResult.deletedCount
        });
      } catch (error) {
        console.error('Error deleting reported product:', error);
        res.status(500).json({ message: 'Failed to delete reported product' });
      }
    });


    // Add Review API
    app.post('/reviews', verifyFBToken, async (req, res) => {
      try {
        const review = req.body;
        review.createdAt = new Date();
        const result = await reviewsCollection.insertOne(review);
        res.status(201).json({ success: true, message: 'Review added successfully', insertedId: result.insertedId });
      } catch (error) {
        console.error('Error adding review:', error);
        res.status(500).json({ success: false, message: 'Something went wrong.' });
      }
    });


    // Get Reviews for a Product
    app.get('/reviews/:productId', async (req, res) => {
      try {
        const { productId } = req.params;
        const reviews = await reviewsCollection
          .find({ productId })
          .sort({ createdAt: -1 }) // latest first
          .toArray();

        res.status(200).json(reviews);
      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
      }
    });


    // Featured Product Patch API
    app.patch('/products/feature/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await techCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isFeatured: true } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).json({ message: "Failed to mark as featured" });
      }
    });


    // Featured Product Accept API
    app.patch('/products/accept/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await techCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'accepted' } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).json({ message: "Failed to accept product" });
      }
    });


    // Featured Product Reject API
    app.patch('/products/reject/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await techCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'rejected' } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).json({ message: "Failed to reject product" });
      }
    });


    // Get only accepted products API with tag search support and pagination
    app.get('/test-products/accepted', async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const query = { status: 'accepted' };

        const products = await techCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await techCollection.countDocuments(query);

        res.send({
          products,
          total
        });
      } catch (err) {
        console.error('Pagination error:', err);
        res.status(500).json({ error: 'Failed to fetch accepted products' });
      }
    });


    // Add new coupon
    app.post('/coupons', verifyFBToken, async (req, res) => {
      try {
        const coupon = req.body;
        coupon.createdAt = new Date();
        const result = await couponCollection.insertOne(coupon);
        res.status(201).json({ success: true, message: "Coupon added", insertedId: result.insertedId });
      } catch (error) {
        console.error('Error adding coupon:', error);
        res.status(500).json({ success: false, message: 'Failed to add coupon' });
      }
    });


    // Get all coupons
    app.get('/coupons', async (req, res) => {
      try {
        const coupons = await couponCollection.find().sort({ createdAt: -1 }).toArray();
        res.send(coupons);
      } catch (error) {
        console.error('Error fetching coupons:', error);
        res.status(500).json({ message: 'Failed to fetch coupons' });
      }
    });


    // Get single coupon by ID
    app.get('/coupons/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const coupon = await couponCollection.findOne({ _id: new ObjectId(id) });
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        res.send(coupon);
      } catch (error) {
        console.error('Error getting coupon:', error);
        res.status(500).json({ message: 'Failed to fetch coupon' });
      }
    });

    
    // Update coupon
    app.put('/coupons/:id', verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;

      try {
        const result = await couponCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: 'Failed to update coupon.' });
      }
    });


    // Delete coupon
    app.delete('/coupons/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await couponCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error('Error deleting coupon:', error);
        res.status(500).json({ message: 'Failed to delete coupon' });
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
