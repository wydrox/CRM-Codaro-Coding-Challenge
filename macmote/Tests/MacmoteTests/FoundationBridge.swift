// Importing Foundation and AppKit here makes Foundation types (Data, Date, etc.)
// and AppKit types (NSObject, etc.) available across the MacmoteTests module
// without needing individual imports in each test file (which would trigger the
// _Testing_Foundation overlay conflict in Swift 6.2).
import Foundation
import AppKit
@testable import Macmote
