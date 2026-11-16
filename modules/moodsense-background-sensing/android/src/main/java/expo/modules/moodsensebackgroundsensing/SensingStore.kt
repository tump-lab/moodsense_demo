package expo.modules.moodsensebackgroundsensing

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * The service's own queue, separate from the app's sensing_events table: the service runs
 * with no JS alive, so it cannot write where JS writes. JS drains it (collectors.ts).
 *
 * `bursts`: one row per accelerometer burst, samples in g as a JSON array of [x, y, z].
 * `step_hours`: steps per local clock hour, plus how many bursts ran in that hour — an hour
 * with a row was covered by the service, so a row with 0 steps is a real zero and a
 * missing hour is "not recorded", never silently zero.
 */
internal class SensingStore private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      "CREATE TABLE bursts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, " +
        "window_ms INTEGER NOT NULL, steps INTEGER, samples TEXT NOT NULL)"
    )
    db.execSQL(
      "CREATE TABLE step_hours (hour_start INTEGER PRIMARY KEY, steps INTEGER NOT NULL, " +
        "bursts INTEGER NOT NULL)"
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

  fun insertBurst(ts: Long, windowMs: Long, steps: Int?, samplesJson: String) {
    writableDatabase.insert("bursts", null, ContentValues().apply {
      put("ts", ts)
      put("window_ms", windowMs)
      if (steps != null) put("steps", steps) else putNull("steps")
      put("samples", samplesJson)
    })
  }

  fun addSteps(hourStart: Long, steps: Int) = bump(hourStart, "steps", steps)

  fun countBurst(hourStart: Long) = bump(hourStart, "bursts", 1)

  // SQLite on API 26 predates UPSERT, hence insert-or-ignore then update.
  private fun bump(hourStart: Long, column: String, by: Int) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL(
        "INSERT OR IGNORE INTO step_hours (hour_start, steps, bursts) VALUES (?, 0, 0)",
        arrayOf<Any>(hourStart)
      )
      db.execSQL(
        "UPDATE step_hours SET $column = $column + ? WHERE hour_start = ?",
        arrayOf<Any>(by, hourStart)
      )
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun readBursts(limit: Int): List<Map<String, Any?>> =
    readableDatabase.rawQuery(
      "SELECT id, ts, window_ms, steps, samples FROM bursts ORDER BY id ASC LIMIT ?",
      arrayOf(limit.toString())
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "id" to c.getLong(0).toDouble(),
              "ts" to c.getLong(1).toDouble(),
              "windowMs" to c.getLong(2).toDouble(),
              "steps" to if (c.isNull(3)) null else c.getInt(3),
              "samples" to c.getString(4),
            )
          )
        }
      }
    }

  fun deleteBurstsThrough(id: Long) {
    writableDatabase.delete("bursts", "id <= ?", arrayOf(id.toString()))
  }

  fun readStepHours(sinceMs: Long): List<Map<String, Any?>> =
    readableDatabase.rawQuery(
      "SELECT hour_start, steps, bursts FROM step_hours WHERE hour_start >= ? ORDER BY hour_start ASC",
      arrayOf(sinceMs.toString())
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "hourStart" to c.getLong(0).toDouble(),
              "steps" to c.getInt(1),
              "bursts" to c.getInt(2),
            )
          )
        }
      }
    }

  /** Bounds the queue for a participant who never opens the app; JS only backfills seven days anyway. */
  fun prune(beforeMs: Long) {
    val db = writableDatabase
    db.delete("bursts", "ts < ?", arrayOf(beforeMs.toString()))
    db.delete("step_hours", "hour_start < ?", arrayOf(beforeMs.toString()))
  }

  fun clear() {
    val db = writableDatabase
    db.delete("bursts", null, null)
    db.delete("step_hours", null, null)
  }

  companion object {
    private const val DB_NAME = "moodsense_background_sensing.db"
    private const val DB_VERSION = 1

    @Volatile
    private var instance: SensingStore? = null

    fun get(context: Context): SensingStore =
      instance ?: synchronized(this) {
        instance ?: SensingStore(context).also { instance = it }
      }
  }
}
