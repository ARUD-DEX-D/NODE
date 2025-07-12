require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,                 // Required for cloud MSSQL
    trustServerCertificate: true  // Often needed for self-signed certs
  }
};

console.log('Connecting to:', process.env.DB_SERVER);

// ✅ Test DB connection at startup
sql.connect(dbConfig)
  .then(() => console.log('✅ Connected to cloud MSSQL'))
  .catch(err => console.error('❌ DB Connection Failed:', err));

// ✅ POST /insert
app.post('/insert', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('name', sql.NVarChar(100), name)
      .query('INSERT INTO Person (Name) VALUES (@name)');

    res.json({ success: true, message: 'Inserted successfully' });
  } catch (err) {
    console.error('❌ Insert Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET /people
app.get('/people', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query('select FACILITY_CKD_ROOMNO,FACILITY_CKD_DEPT,status,userid from facility_check_details');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Fetch Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET /person/:id
app.get('/person/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM login WHERE USERID = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Fetch by ID Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST /register
app.post('/register', async (req, res) => {
  const { USERNAME, DEPT, USERID, PASSWORD } = req.body;
  if (!USERNAME || !DEPT || !USERID || !PASSWORD) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('USERNAME', sql.NVarChar(100), USERNAME)
      .input('DEPT', sql.NVarChar(100), DEPT)
      .input('USERID', sql.NVarChar(100), USERID)
      .input('PASSWORD', sql.NVarChar(100), PASSWORD)
      .query('INSERT INTO login (USERNAME, DEPT, USERID, PASSWORD) VALUES (@USERNAME, @DEPT, @USERID, @PASSWORD)');

    res.json({ success: true, message: 'Inserted successfully' });
  } catch (err) {
    console.error('❌ Register Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST /login
app.post('/login', async (req, res) => {
  const { USERID, PASSWORD } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('USERID', sql.VarChar, USERID)
      .input('PASSWORD', sql.VarChar, PASSWORD)
      .query('SELECT * FROM login WHERE USERID = @USERID AND PASSWORD = @PASSWORD');

    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      res.status(200).json({
        message: 'Login successful',
        name: user.USERNAME,
        department: user.DEPT
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


app.post('/close-ticket', async (req, res) => {
  const { ROOMNO, USERID } = req.body;

  if (!ROOMNO || !USERID) {
    return res.status(400).json({ error: 'ROOMNO and USERID are required' });
  }

  try {
    const pool = await sql.connect(dbConfig);

    const result = await pool.request()
      .input('ROOMNO', sql.NVarChar(100), ROOMNO)
      .input('USERID', sql.NVarChar(100), USERID)
     
      .query(`
        UPDATE FACILITY_CHECK_DETAILS
        SET 
          COMPLETED_TIME = (SELECT DATEADD(MINUTE, 330, GETUTCDATE()) AS CurrentIST),
          USERID = @USERID,
          TKT_STATUS = 1
        WHERE FACILITY_CKD_ROOMNO = @ROOMNO AND tkt_status != 1
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(400).json({ message: 'Ticket is already closed or not found.' });
    }

    res.json({ success: true, message: 'Ticket completed and closed successfully.' });
  } catch (err) {
    console.error('❌ Complete Ticket Error:', err);
    res.status(500).json({ error: err.message });
  }
});





app.post('/assign', async (req, res) => {
  const { userid, status, roomNo, department, forceReassign } = req.body;

  try {
    const pool = await sql.connect(dbConfig);

    const result = await pool.request()
      .input('roomNo', sql.NVarChar, roomNo)
      .input('department', sql.NVarChar, department)
      .query(`
        SELECT STATUS, userid FROM FACILITY_CHECK_DETAILS
        WHERE FACILITY_CKD_ROOMNO = @roomNo AND FACILITY_CKD_DEPT = @department
      `);

    if (result.recordset.length === 0) {
      return res.status(404).send({ error: 'Record not found' });
    }

    const current = result.recordset[0];

    if (current.STATUS === 0 || current.STATUS === null) {
      // ✅ First-time assign
      await pool.request()
        .input('userid', sql.NVarChar, userid)
        .input('roomNo', sql.NVarChar, roomNo)
        .input('department', sql.NVarChar, department)
        .query(`
          UPDATE FACILITY_CHECK_DETAILS
          SET 
            ASSIGNED_TIME = DATEADD(MINUTE, 330, GETUTCDATE()),
            STATUS = 1,
            userid = @userid
          WHERE FACILITY_CKD_ROOMNO = @roomNo AND FACILITY_CKD_DEPT = @department
        `);

      return res.send({ success: true, message: 'Assigned successfully.' });

    } else if (current.STATUS === 1 && !forceReassign) {
      // ⚠️ Already assigned - prompt reassign
      return res.send({
        alreadyAssigned: true,
        currentUser: current.userid?.trim() || 'Unknown',
        message: `Already assigned to ${current.userid?.trim()}. Do you want to reassign?`
      });

    } else if (current.STATUS === 1 && forceReassign) {
      // ✅ Reassign (update only userid)
      await pool.request()
        .input('userid', sql.NVarChar, userid)
        .input('roomNo', sql.NVarChar, roomNo)
        .input('department', sql.NVarChar, department)
        .query(`
          UPDATE FACILITY_CHECK_DETAILS
          SET userid = @userid
          WHERE FACILITY_CKD_ROOMNO = @roomNo AND FACILITY_CKD_DEPT = @department
        `);

      return res.send({ success: true, message: 'User reassigned.' });

    } else {
      return res.status(400).send({ error: 'Cannot assign. Task already completed or SLA breached.' });
    }

  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});



// ✅ Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});
