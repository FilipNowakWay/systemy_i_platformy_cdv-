from flask import Flask, request, render_template, redirect, url_for, session, flash
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import os
import logging
from logging.handlers import RotatingFileHandler
from opencensus.ext.azure.log_exporter import AzureLogHandler
from opencensus.ext.flask.flask_middleware import FlaskMiddleware
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.trace.samplers import ProbabilitySampler

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'secret!'

# Application Insights configuration
app_insights_instrumentation_key = '0a033b2f-a3bb-4fff-a9f8-f1b607349a15'

if app_insights_instrumentation_key:
    # Logging configuration
    handler = AzureLogHandler(connection_string=f'InstrumentationKey={app_insights_instrumentation_key}')
    handler.setLevel(logging.INFO)
    app.logger.addHandler(handler)

    # Middleware for tracing
    middleware = FlaskMiddleware(
        app,
        exporter=AzureExporter(connection_string=f'InstrumentationKey={app_insights_instrumentation_key}'),
        sampler=ProbabilitySampler(rate=1.0)
    )

# Hardcode database configuration
server = 'mydatabasefilip.database.windows.net'
database = 'myazuredatabase'
username = 'filip'
password = 'Nowak28072001!'
driver = 'ODBC Driver 17 for SQL Server'

connection_string = f"mssql+pyodbc://{username}:{password}@{server}:1433/{database}?driver={driver}"

# Set up database connection pooling
engine = create_engine(connection_string, pool_size=10, max_overflow=20)
Session = sessionmaker(bind=engine)

def get_db_session():
    try:
        return Session()
    except Exception as e:
        app.logger.error(f"Error connecting to database: {e}")
        flash(f"Error connecting to database: {e}", 'error')
        return None

@app.route('/')
def index():
    if 'username' in session:
        return redirect(url_for('welcome'))
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        app.logger.info(f"Attempting to register user: {username}")
        db_session = get_db_session()
        if db_session:
            try:
                db_session.execute(text("INSERT INTO users (username, password) VALUES (:username, :password)"),
                                   {'username': username, 'password': password})
                db_session.commit()
                flash(f"User {username} registered successfully.", 'success')
                return redirect(url_for('login'))
            except Exception as e:
                db_session.rollback()
                app.logger.error(f"Error during registration: {e}")
                flash(f"Error during registration: {e}", 'error')
                return 'Registration failed due to an internal error.'
            finally:
                db_session.close()
        flash("Database connection failed.", 'error')
        return 'Database connection failed.'
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        app.logger.info(f"Attempting to log in user: {username}")
        db_session = get_db_session()
        if db_session:
            try:
                result = db_session.execute(text("SELECT id, password FROM users WHERE username=:username"),
                                            {'username': username}).fetchone()
                if result and result[1] == password:
                    session['username'] = username
                    flash(f"User {username} logged in successfully.", 'success')
                    return redirect(url_for('welcome'))
                flash(f"Invalid username or password for user {username}.", 'error')
                return 'Invalid username or password!'
            except Exception as e:
                app.logger.error(f"Error during login: {e}")
                flash(f"Error during login: {e}", 'error')
                return 'Login failed due to an internal error.'
            finally:
                db_session.close()
        flash("Database connection failed.", 'error')
        return 'Database connection failed.'
    return render_template('login.html')

@app.route('/welcome')
def welcome():
    if 'username' not in session:
        return redirect(url_for('login'))
    db_session = get_db_session()
    if db_session:
        try:
            result = db_session.execute(text("SELECT id, account_name, account_password FROM accounts WHERE user_id=(SELECT id FROM users WHERE username=:username)"),
                                        {'username': session['username']}).fetchall()
            accounts = [{'id': row[0], 'account_name': row[1], 'account_password': row[2]} for row in result]
            return render_template('welcome.html', username=session['username'], accounts=accounts)
        except Exception as e:
            app.logger.error(f"Error fetching accounts: {e}")
            flash(f"Error fetching accounts: {e}", 'error')
        finally:
            db_session.close()
    return render_template('welcome.html', username=session['username'])

@app.route('/add_account', methods=['POST'])
def add_account():
    if 'username' not in session:
        return redirect(url_for('login'))
    account_name = request.form['account_name']
    account_password = request.form['account_password']
    db_session = get_db_session()
    if db_session:
        try:
            db_session.execute(text("INSERT INTO accounts (user_id, account_name, account_password) VALUES ((SELECT id FROM users WHERE username=:username), :account_name, :account_password)"),
                               {'username': session['username'], 'account_name': account_name, 'account_password': account_password})
            db_session.commit()
            flash("Account added successfully.", 'success')
        except Exception as e:
            db_session.rollback()
            app.logger.error(f"Error adding account: {e}")
            flash(f"Error adding account: {e}", 'error')
        finally:
            db_session.close()
    return redirect(url_for('welcome'))

@app.route('/delete_account/<int:account_id>', methods=['POST'])
def delete_account(account_id):
    if 'username' not in session:
        return redirect(url_for('login'))
    db_session = get_db_session()
    if db_session:
        try:
            db_session.execute(text("DELETE FROM accounts WHERE id=:account_id AND user_id=(SELECT id FROM users WHERE username=:username)"),
                               {'account_id': account_id, 'username': session['username']})
            db_session.commit()
            flash("Account deleted successfully.", 'success')
        except Exception as e:
            db_session.rollback()
            app.logger.error(f"Error deleting account: {e}")
            flash(f"Error deleting account: {e}", 'error')
        finally:
            db_session.close()
    return redirect(url_for('welcome'))

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('index'))

if __name__ == '__main__':
    if not app.debug:
        handler = RotatingFileHandler('app.log', maxBytes=10000, backupCount=1)
        handler.setLevel(logging.INFO)
        app.logger.addHandler(handler)
    app.run(host='0.0.0.0', port=5000)
