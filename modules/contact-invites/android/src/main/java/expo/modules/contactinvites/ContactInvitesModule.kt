package expo.modules.contactinvites

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract.CommonDataKinds.Phone
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ContactInvitesModule : Module() {
  private data class Pick(val id: Int, val promise: Promise, var cancelled: Boolean = false)

  private var pendingPick: Pick? = null

  override fun definition() = ModuleDefinition {
    Name("ContactInvites")

    AsyncFunction("pickPhone") { id: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || pendingPick != null) {
        promise.resolve(mapOf("status" to "unavailable"))
        return@AsyncFunction
      }

      val intent = Intent(Intent.ACTION_PICK).setType(Phone.CONTENT_TYPE)
      try {
        pendingPick = Pick(id, promise)
        activity.startActivityForResult(intent, PICK_PHONE_REQUEST)
      } catch (_: ActivityNotFoundException) {
        finishPick("unavailable")
      } catch (_: SecurityException) {
        finishPick("denied")
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { activity, (requestCode, resultCode, data) ->
      val pick = pendingPick
      if (requestCode == PICK_PHONE_REQUEST && pick != null) {
        val uri = data?.data
        if (pick.cancelled || resultCode != Activity.RESULT_OK) {
          finishPick("cancelled")
        } else if (uri?.scheme != "content") {
          finishPick("noPhone")
        } else {
          readPhone(activity, uri)
        }
      }
    }

    OnActivityDestroys {
      finishPick("cancelled")
    }

    AsyncFunction("cancel") { id: Int ->
      val pick = pendingPick
      if (pick != null && pick.id == id && !pick.cancelled) {
        pick.cancelled = true
        appContext.currentActivity?.finishActivity(PICK_PHONE_REQUEST)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("composeText") { _: Int, number: String, body: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction "unavailable"
      val intent = Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null))
        .putExtra("sms_body", body)
      try {
        activity.startActivity(intent)
        // Android messaging apps do not report whether the user sent the draft.
        "opened"
      } catch (_: ActivityNotFoundException) {
        "unavailable"
      } catch (_: SecurityException) {
        "unavailable"
      }
    }.runOnQueue(Queues.MAIN)
  }

  private fun readPhone(activity: Activity, uri: Uri) {
    try {
      val number = activity.contentResolver.query(uri, arrayOf(Phone.NUMBER), null, null, null)
        ?.use { rows ->
          val column = rows.getColumnIndex(Phone.NUMBER)
          if (column < 0 || !rows.moveToFirst()) return@use null
          val selected = rows.getString(column)
          if (rows.moveToNext()) null else selected
        }
      if (number.isNullOrBlank()) finishPick("noPhone") else finishPick("selected", number)
    } catch (_: SecurityException) {
      finishPick("denied")
    } catch (_: RuntimeException) {
      finishPick("unavailable")
    }
  }

  private fun finishPick(status: String, number: String? = null) {
    val promise = pendingPick?.promise ?: return
    pendingPick = null
    promise.resolve(if (number == null) mapOf("status" to status) else mapOf("status" to status, "number" to number))
  }

  private companion object {
    const val PICK_PHONE_REQUEST = 0x5754
  }
}
